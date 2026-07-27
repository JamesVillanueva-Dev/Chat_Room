'use strict';

const config = require('../config');
const logger = require('../logger').child({ component: 'db' });
const { openDatabase } = require('./driver');
const { migrate } = require('./migrate');

const db = openDatabase(config.db.file);
const result = migrate(db);

logger.info('database ready', {
  driver: db.name,
  file: config.db.file,
  migrationsApplied: result.applied.length,
});

// Tables holding user data, ordered so children are cleared before parents.
const DATA_TABLES = [
  'mentions',
  'reactions',
  'messages',
  'invites',
  'moderation_log',
  'room_members',
  'attachments',
  'link_previews',
  'sessions',
  'rooms',
  'users',
];

/**
 * Truncates all application data and restores the seeded default room.
 * Intended for test setup, where each case wants a clean slate without paying
 * to re-run migrations.
 */
const resetDatabase = () => {
  db.transaction(() => {
    for (const table of DATA_TABLES) {
      db.run(`DELETE FROM ${table}`);
    }
    db.run("DELETE FROM sqlite_sequence WHERE name NOT IN ('migrations')");
    db.run(
      `INSERT INTO rooms (slug, name, topic, kind, visibility)
       VALUES ('general', 'General', 'Everyone starts here.', 'room', 'public')`
    );
  })();
};

module.exports = db;
module.exports.resetDatabase = resetDatabase;
