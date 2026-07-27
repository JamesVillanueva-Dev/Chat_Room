'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const logger = require('../logger').child({ component: 'migrate' });

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/i;

const checksum = (contents) =>
  crypto.createHash('sha256').update(contents).digest('hex').slice(0, 16);

const loadMigrations = (dir = MIGRATIONS_DIR) => {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      if (!match) return null;
      const contents = fs.readFileSync(path.join(dir, file), 'utf8');
      return {
        id: Number.parseInt(match[1], 10),
        name: match[2],
        file,
        sql: contents,
        checksum: checksum(contents),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
};

const ensureMigrationsTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
};

const assertUniqueIds = (migrations) => {
  const seen = new Map();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(
        `Duplicate migration id ${migration.id}: ${seen.get(migration.id)} and ${migration.file}`
      );
    }
    seen.set(migration.id, migration.file);
  }
};

/**
 * Applies every migration that has not run yet, in numeric order, each in its
 * own transaction. Already-applied migrations are checksummed so an edit to a
 * file that has shipped fails loudly instead of silently diverging between
 * environments.
 */
const migrate = (db, { dir = MIGRATIONS_DIR } = {}) => {
  ensureMigrationsTable(db);

  const migrations = loadMigrations(dir);
  assertUniqueIds(migrations);

  const applied = new Map(
    db.all('SELECT id, name, checksum FROM migrations').map((row) => [row.id, row])
  );

  const pending = [];
  for (const migration of migrations) {
    const record = applied.get(migration.id);
    if (!record) {
      pending.push(migration);
      continue;
    }
    if (record.checksum !== migration.checksum) {
      throw new Error(
        `Migration ${migration.file} has changed since it was applied ` +
          `(recorded ${record.checksum}, found ${migration.checksum}). ` +
          'Add a new migration instead of editing an applied one.'
      );
    }
  }

  if (pending.length === 0) {
    logger.debug('schema up to date', { applied: applied.size });
    return { applied: [], alreadyApplied: applied.size };
  }

  const appliedNow = [];
  for (const migration of pending) {
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.run(
        'INSERT INTO migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        migration.id,
        migration.name,
        migration.checksum,
        new Date().toISOString()
      );
    });

    try {
      run();
    } catch (error) {
      logger.error('migration failed', { file: migration.file, error });
      throw new Error(`Migration ${migration.file} failed: ${error.message}`);
    }

    appliedNow.push(migration.file);
    logger.info('migration applied', { file: migration.file });
  }

  return { applied: appliedNow, alreadyApplied: applied.size };
};

module.exports = { migrate, loadMigrations, MIGRATIONS_DIR };
