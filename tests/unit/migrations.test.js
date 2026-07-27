import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../../src/db/driver');
const { migrate, loadMigrations, MIGRATIONS_DIR } = require('../../src/db/migrate');

const temporaryDirs = [];

const writeMigrations = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-migrations-'));
  temporaryDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql);
  }
  return dir;
};

afterEach(() => {
  while (temporaryDirs.length > 0) {
    fs.rmSync(temporaryDirs.pop(), { recursive: true, force: true });
  }
});

describe('migration runner', () => {
  it('applies migrations in numeric order, not alphabetical', () => {
    const dir = writeMigrations({
      '002_second.sql': 'INSERT INTO ordering (step) VALUES (2);',
      '010_third.sql': 'INSERT INTO ordering (step) VALUES (10);',
      '001_first.sql': 'CREATE TABLE ordering (step INTEGER); INSERT INTO ordering (step) VALUES (1);',
    });

    const db = openDatabase(':memory:');
    migrate(db, { dir });

    // Alphabetically 010 sorts before 002; numerically it must come last.
    expect(db.all('SELECT step FROM ordering').map((r) => r.step)).toEqual([1, 2, 10]);
    db.close();
  });

  it('records what it applied and is idempotent', () => {
    const dir = writeMigrations({ '001_init.sql': 'CREATE TABLE t (id INTEGER);' });
    const db = openDatabase(':memory:');

    const first = migrate(db, { dir });
    expect(first.applied).toEqual(['001_init.sql']);

    const second = migrate(db, { dir });
    expect(second.applied).toEqual([]);
    expect(db.pluck('SELECT COUNT(*) FROM migrations')).toBe(1);
    db.close();
  });

  it('applies only the new migration on a second run', () => {
    const dir = writeMigrations({ '001_init.sql': 'CREATE TABLE t (id INTEGER);' });
    const db = openDatabase(':memory:');
    migrate(db, { dir });

    fs.writeFileSync(path.join(dir, '002_more.sql'), 'CREATE TABLE u (id INTEGER);');
    const second = migrate(db, { dir });

    expect(second.applied).toEqual(['002_more.sql']);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'u'")).toBeTruthy();
    db.close();
  });

  it('refuses to run when an applied migration has been edited', () => {
    const dir = writeMigrations({ '001_init.sql': 'CREATE TABLE t (id INTEGER);' });
    const db = openDatabase(':memory:');
    migrate(db, { dir });

    fs.writeFileSync(path.join(dir, '001_init.sql'), 'CREATE TABLE t (id INTEGER, extra TEXT);');
    expect(() => migrate(db, { dir })).toThrow(/has changed since it was applied/);
    db.close();
  });

  it('rolls the whole migration back when it fails part way', () => {
    const dir = writeMigrations({
      '001_init.sql': 'CREATE TABLE keep (id INTEGER);',
      '002_broken.sql': 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;',
    });
    const db = openDatabase(':memory:');

    expect(() => migrate(db, { dir })).toThrow(/002_broken/);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'keep'")).toBeTruthy();
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'half'")).toBeFalsy();
    expect(db.pluck('SELECT COUNT(*) FROM migrations')).toBe(1);
    db.close();
  });

  it('rejects duplicate migration ids', () => {
    const dir = writeMigrations({
      '001_a.sql': 'CREATE TABLE a (id INTEGER);',
      '001_b.sql': 'CREATE TABLE b (id INTEGER);',
    });
    const db = openDatabase(':memory:');
    expect(() => migrate(db, { dir })).toThrow(/Duplicate migration id/);
    db.close();
  });

  it('ignores files that are not numbered migrations', () => {
    const dir = writeMigrations({
      '001_real.sql': 'CREATE TABLE real_table (id INTEGER);',
      'README.md': 'not a migration',
      'draft.sql': 'CREATE TABLE nope (id INTEGER);',
    });
    const db = openDatabase(':memory:');
    const result = migrate(db, { dir });

    expect(result.applied).toEqual(['001_real.sql']);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'nope'")).toBeFalsy();
    db.close();
  });
});

describe('the shipped schema', () => {
  it('has uniquely numbered migrations', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThan(0);

    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('builds every table the application queries', () => {
    const db = openDatabase(':memory:');
    migrate(db);

    const tables = new Set(
      db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name)
    );
    for (const table of [
      'users', 'rooms', 'room_members', 'messages', 'reactions',
      'attachments', 'invites', 'mentions', 'moderation_log',
      'link_previews', 'sessions', 'messages_fts',
    ]) {
      expect(tables.has(table), `missing table ${table}`).toBe(true);
    }
    db.close();
  });

  it('seeds a default room', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(db.get("SELECT name FROM rooms WHERE slug = 'general'").name).toBe('General');
    db.close();
  });

  it('keeps the search index in step with edits and deletes', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.run("INSERT INTO users (username, password_hash) VALUES ('a', 'x')");

    const { lastInsertRowid } = db.run(
      "INSERT INTO messages (room_id, user_id, body) VALUES (1, 1, 'orange pineapple')"
    );
    const id = Number(lastInsertRowid);
    const search = (term) =>
      db.all('SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?', term).length;

    expect(search('pineapple')).toBe(1);

    db.run("UPDATE messages SET body = 'banana split' WHERE id = ?", id);
    expect(search('pineapple')).toBe(0);
    expect(search('banana')).toBe(1);

    db.run('DELETE FROM messages WHERE id = ?', id);
    expect(search('banana')).toBe(0);
    db.close();
  });
});
