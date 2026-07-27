'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Thin wrapper that gives the rest of the app one synchronous SQLite API.
 *
 * `better-sqlite3` is preferred, but it is a native addon and needs a C++
 * toolchain to build when no prebuilt binary matches the running Node version.
 * Node 22.5+ ships an equivalent synchronous engine as `node:sqlite`, so we
 * fall back to it rather than making a compiler a hard install requirement.
 * Both expose `prepare().get/.all/.run`, so only pragmas and transactions need
 * smoothing over.
 */
const openRawDatabase = (file) => {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return { raw: new BetterSqlite3(file), name: 'better-sqlite3' };
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }

  const { DatabaseSync } = require('node:sqlite');
  return { raw: new DatabaseSync(file), name: 'node:sqlite' };
};

const ensureDirectory = (file) => {
  if (file === ':memory:' || file.startsWith('file:')) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
};

const openDatabase = (file) => {
  ensureDirectory(file);
  const { raw, name } = openRawDatabase(file);

  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA synchronous = NORMAL');

  const statementCache = new Map();
  let depth = 0;

  const prepare = (sql) => {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = raw.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  };

  // Both drivers reject `undefined`; treating it as NULL keeps callers from
  // having to normalise every optional column at the call site.
  const normalizeParams = (params) =>
    params.map((value) => {
      if (value === undefined) return null;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    });

  const api = {
    name,
    raw,
    file,

    exec(sql) {
      raw.exec(sql);
    },

    get(sql, ...params) {
      return prepare(sql).get(...normalizeParams(params));
    },

    all(sql, ...params) {
      return prepare(sql).all(...normalizeParams(params));
    },

    run(sql, ...params) {
      return prepare(sql).run(...normalizeParams(params));
    },

    pluck(sql, ...params) {
      const row = api.get(sql, ...params);
      if (!row) return undefined;
      return Object.values(row)[0];
    },

    /**
     * Wraps `fn` so every call runs atomically. Nested calls use SAVEPOINTs so
     * a repository helper can open a transaction without knowing whether its
     * caller already did.
     */
    transaction(fn) {
      return (...args) => {
        const savepoint = `sp_${depth}`;
        if (depth === 0) raw.exec('BEGIN');
        else raw.exec(`SAVEPOINT ${savepoint}`);
        depth += 1;

        try {
          const result = fn(...args);
          depth -= 1;
          if (depth === 0) raw.exec('COMMIT');
          else raw.exec(`RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          depth -= 1;
          if (depth === 0) {
            raw.exec('ROLLBACK');
          } else {
            raw.exec(`ROLLBACK TO ${savepoint}`);
            raw.exec(`RELEASE ${savepoint}`);
          }
          throw error;
        }
      };
    },

    close() {
      statementCache.clear();
      raw.close();
    },
  };

  return api;
};

module.exports = { openDatabase };
