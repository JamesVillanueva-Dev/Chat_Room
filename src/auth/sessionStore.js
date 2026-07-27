'use strict';

const session = require('express-session');

const config = require('../config');
const db = require('../db');
const logger = require('../logger').child({ component: 'sessions' });

/**
 * express-session store backed by the same SQLite file as everything else.
 * Sessions outlive restarts, and a periodic sweep drops expired rows so the
 * table does not grow without bound.
 */
class SqliteSessionStore extends session.Store {
  constructor({ ttlMs = config.session.maxAgeMs, pruneIntervalMs = config.session.pruneIntervalMs } = {}) {
    super();
    this.ttlMs = ttlMs;

    if (pruneIntervalMs > 0) {
      this.pruneTimer = setInterval(() => this.prune(), pruneIntervalMs);
      // Never hold the event loop open just to expire sessions.
      this.pruneTimer.unref?.();
    }
  }

  expiryFor(sess) {
    const cookieExpires = sess?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + this.ttlMs;
  }

  get(sid, callback) {
    try {
      const row = db.get('SELECT data, expires_at FROM sessions WHERE sid = ?', sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        db.run('DELETE FROM sessions WHERE sid = ?', sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      db.run(
        `INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)
         ON CONFLICT (sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data`,
        sid,
        this.expiryFor(sess),
        JSON.stringify(sess)
      );
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      db.run('UPDATE sessions SET expires_at = ? WHERE sid = ?', this.expiryFor(sess), sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.run('DELETE FROM sessions WHERE sid = ?', sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  length(callback) {
    try {
      return callback(null, db.pluck('SELECT COUNT(*) FROM sessions'));
    } catch (error) {
      return callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      db.run('DELETE FROM sessions');
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  all(callback) {
    try {
      const rows = db.all('SELECT sid, data FROM sessions WHERE expires_at > ?', Date.now());
      return callback(null, rows.map((row) => ({ sid: row.sid, ...JSON.parse(row.data) })));
    } catch (error) {
      return callback(error);
    }
  }

  prune() {
    try {
      const { changes } = db.run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
      if (changes > 0) logger.debug('pruned expired sessions', { count: changes });
    } catch (error) {
      logger.warn('session prune failed', { error });
    }
  }

  /** Ends every session belonging to a user — used when banning. */
  destroyForUser(userId) {
    const rows = db.all('SELECT sid, data FROM sessions', );
    let removed = 0;
    for (const row of rows) {
      try {
        if (JSON.parse(row.data)?.userId === userId) {
          db.run('DELETE FROM sessions WHERE sid = ?', row.sid);
          removed += 1;
        }
      } catch {
        // A row we cannot parse is unusable anyway; drop it.
        db.run('DELETE FROM sessions WHERE sid = ?', row.sid);
      }
    }
    return removed;
  }

  close() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}

module.exports = { SqliteSessionStore };
