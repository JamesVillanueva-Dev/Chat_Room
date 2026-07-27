'use strict';

const db = require('../index');

const toEntry = (row) => ({
  id: row.id,
  action: row.action,
  reason: row.reason || '',
  expiresAt: row.expires_at || null,
  createdAt: row.created_at,
  actor: row.actor_id ? { id: row.actor_id, username: row.actor_username } : null,
  target: row.target_user_id ? { id: row.target_user_id, username: row.target_username } : null,
  room: row.room_id ? { id: row.room_id, slug: row.room_slug, name: row.room_name } : null,
});

const log = ({ actorId = null, targetUserId = null, roomId = null, action, reason = '', expiresAt = null }) => {
  const { lastInsertRowid } = db.run(
    `INSERT INTO moderation_log (actor_id, target_user_id, room_id, action, reason, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    actorId,
    targetUserId,
    roomId,
    action,
    reason,
    expiresAt
  );
  return Number(lastInsertRowid);
};

const listRecent = ({ limit = 50, offset = 0 } = {}) =>
  db
    .all(
      `SELECT ml.*,
              actor.username  AS actor_username,
              target.username AS target_username,
              r.slug          AS room_slug,
              r.name          AS room_name
       FROM moderation_log ml
       LEFT JOIN users actor  ON actor.id = ml.actor_id
       LEFT JOIN users target ON target.id = ml.target_user_id
       LEFT JOIN rooms r      ON r.id = ml.room_id
       ORDER BY ml.id DESC
       LIMIT ? OFFSET ?`,
      limit,
      offset
    )
    .map(toEntry);

const countEntries = () => db.pluck('SELECT COUNT(*) FROM moderation_log');

module.exports = { log, listRecent, countEntries };
