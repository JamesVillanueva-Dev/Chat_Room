'use strict';

const db = require('../index');
const { colorForName } = require('../../lib/identity');

const PUBLIC_COLUMNS = `
  id, username, display_name, bio, avatar_path, avatar_color, role,
  presence, status_message, muted_until, banned_at, banned_reason,
  created_at, last_seen_at
`;

const toPublicUser = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    bio: row.bio || '',
    avatarUrl: row.avatar_path || null,
    avatarColor: row.avatar_color,
    role: row.role,
    presence: row.presence,
    statusMessage: row.status_message || '',
    isBanned: Boolean(row.banned_at),
    mutedUntil: row.muted_until || null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || null,
  };
};

const nowIso = () => new Date().toISOString();

const createUser = ({ username, passwordHash, displayName = '', role = 'user' }) => {
  const { lastInsertRowid } = db.run(
    `INSERT INTO users (username, password_hash, display_name, avatar_color, role)
     VALUES (?, ?, ?, ?, ?)`,
    username,
    passwordHash,
    displayName || username,
    colorForName(username),
    role
  );
  return findById(Number(lastInsertRowid));
};

const findById = (id) => toPublicUser(db.get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, id));

const findByUsername = (username) =>
  toPublicUser(db.get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username = ?`, username));

/** Includes the password hash; only for the login path. */
const findCredentialsByUsername = (username) =>
  db.get('SELECT id, username, password_hash, banned_at, banned_reason FROM users WHERE username = ?', username);

const findManyByIds = (ids) => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .all(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id IN (${placeholders})`, ...ids)
    .map(toPublicUser);
};

const findManyByUsernames = (usernames) => {
  if (usernames.length === 0) return [];
  const placeholders = usernames.map(() => '?').join(',');
  return db
    .all(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username IN (${placeholders})`, ...usernames)
    .map(toPublicUser);
};

const countUsers = () => db.pluck('SELECT COUNT(*) FROM users');

const updateProfile = (id, { displayName, bio, statusMessage, presence }) => {
  db.run(
    `UPDATE users SET
       display_name   = COALESCE(?, display_name),
       bio            = COALESCE(?, bio),
       status_message = COALESCE(?, status_message),
       presence       = COALESCE(?, presence)
     WHERE id = ?`,
    displayName ?? null,
    bio ?? null,
    statusMessage ?? null,
    presence ?? null,
    id
  );
  return findById(id);
};

const setAvatarPath = (id, avatarPath) => {
  db.run('UPDATE users SET avatar_path = ? WHERE id = ?', avatarPath, id);
  return findById(id);
};

const setPresence = (id, presence) => {
  db.run('UPDATE users SET presence = ?, last_seen_at = ? WHERE id = ?', presence, nowIso(), id);
  return findById(id);
};

const touchLastSeen = (id) => {
  db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), id);
};

const markAllOffline = () => db.run("UPDATE users SET presence = 'offline'").changes;

const setRole = (id, role) => {
  db.run('UPDATE users SET role = ? WHERE id = ?', role, id);
  return findById(id);
};

const setBanned = (id, { banned, reason = '' }) => {
  db.run(
    'UPDATE users SET banned_at = ?, banned_reason = ? WHERE id = ?',
    banned ? nowIso() : null,
    banned ? reason : null,
    id
  );
  return findById(id);
};

const setGlobalMute = (id, mutedUntilIso) => {
  db.run('UPDATE users SET muted_until = ? WHERE id = ?', mutedUntilIso, id);
  return findById(id);
};

const isGloballyMuted = (id) => {
  const row = db.get('SELECT muted_until FROM users WHERE id = ?', id);
  if (!row?.muted_until) return false;
  return new Date(row.muted_until).getTime() > Date.now();
};

const listUsers = ({ query = '', limit = 50, offset = 0 } = {}) => {
  if (query) {
    return db
      .all(
        `SELECT ${PUBLIC_COLUMNS} FROM users
         WHERE username LIKE ? OR display_name LIKE ?
         ORDER BY username LIMIT ? OFFSET ?`,
        `%${query}%`,
        `%${query}%`,
        limit,
        offset
      )
      .map(toPublicUser);
  }
  return db
    .all(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY username LIMIT ? OFFSET ?`, limit, offset)
    .map(toPublicUser);
};

/** Prefix search backing @mention autocomplete. */
const searchByPrefix = (prefix, limit = 8) =>
  db
    .all(
      `SELECT ${PUBLIC_COLUMNS} FROM users
       WHERE username LIKE ? OR display_name LIKE ?
       ORDER BY CASE WHEN username LIKE ? THEN 0 ELSE 1 END, username
       LIMIT ?`,
      `${prefix}%`,
      `${prefix}%`,
      `${prefix}%`,
      limit
    )
    .map(toPublicUser);

module.exports = {
  toPublicUser,
  createUser,
  findById,
  findByUsername,
  findCredentialsByUsername,
  findManyByIds,
  findManyByUsernames,
  countUsers,
  updateProfile,
  setAvatarPath,
  setPresence,
  touchLastSeen,
  markAllOffline,
  setRole,
  setBanned,
  setGlobalMute,
  isGloballyMuted,
  listUsers,
  searchByPrefix,
};
