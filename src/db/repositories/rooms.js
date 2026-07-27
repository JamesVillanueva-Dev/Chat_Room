'use strict';

const db = require('../index');
const users = require('./users');
const { slugify } = require('../../lib/text');
const { randomToken } = require('../../lib/identity');

const nowIso = () => new Date().toISOString();

const toRoom = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    topic: row.topic || '',
    kind: row.kind,
    visibility: row.visibility,
    hasPassword: Boolean(row.password_hash),
    dmKey: row.dm_key || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    archivedAt: row.archived_at || null,
  };
};

const dmKeyFor = (a, b) => [a, b].sort((x, y) => x - y).join(':');

const findById = (id) => toRoom(db.get('SELECT * FROM rooms WHERE id = ?', id));
const findBySlug = (slug) => toRoom(db.get('SELECT * FROM rooms WHERE slug = ?', slug));

const findPasswordHash = (roomId) =>
  db.get('SELECT password_hash FROM rooms WHERE id = ?', roomId)?.password_hash || null;

const uniqueSlug = (base) => {
  const root = slugify(base) || `room-${randomToken(3)}`;
  let candidate = root;
  let suffix = 2;
  while (db.get('SELECT 1 AS hit FROM rooms WHERE slug = ?', candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const createRoom = ({ name, topic = '', visibility = 'public', passwordHash = null, createdBy }) => {
  const slug = uniqueSlug(name);
  const { lastInsertRowid } = db.run(
    `INSERT INTO rooms (slug, name, topic, kind, visibility, password_hash, created_by)
     VALUES (?, ?, ?, 'room', ?, ?, ?)`,
    slug,
    name,
    topic,
    visibility,
    passwordHash,
    createdBy ?? null
  );
  return findById(Number(lastInsertRowid));
};

const updateRoom = (roomId, { name, topic, visibility }) => {
  db.run(
    `UPDATE rooms SET
       name       = COALESCE(?, name),
       topic      = COALESCE(?, topic),
       visibility = COALESCE(?, visibility)
     WHERE id = ?`,
    name ?? null,
    topic ?? null,
    visibility ?? null,
    roomId
  );
  return findById(roomId);
};

const setPasswordHash = (roomId, passwordHash) => {
  db.run('UPDATE rooms SET password_hash = ? WHERE id = ?', passwordHash, roomId);
  return findById(roomId);
};

const archiveRoom = (roomId) => {
  db.run('UPDATE rooms SET archived_at = ? WHERE id = ?', nowIso(), roomId);
  return findById(roomId);
};

const deleteRoom = (roomId) => db.run('DELETE FROM rooms WHERE id = ? AND kind = ?', roomId, 'room').changes;

// --- membership ---------------------------------------------------------

const toMember = (row) => ({
  ...users.toPublicUser(row),
  roomRole: row.room_role,
  joinedAt: row.member_joined_at,
  lastReadMessageId: row.last_read_message_id,
  mutedUntil: row.member_muted_until || null,
  isRoomBanned: Boolean(row.member_banned_at),
});

const MEMBER_COLUMNS = `
  u.id, u.username, u.display_name, u.bio, u.avatar_path, u.avatar_color, u.role,
  u.presence, u.status_message, u.muted_until, u.banned_at, u.banned_reason,
  u.created_at, u.last_seen_at,
  rm.role        AS room_role,
  rm.joined_at   AS member_joined_at,
  rm.last_read_message_id,
  rm.muted_until AS member_muted_until,
  rm.banned_at   AS member_banned_at
`;

const getMembership = (roomId, userId) =>
  db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId);

const isMember = (roomId, userId) => Boolean(getMembership(roomId, userId));

const addMember = (roomId, userId, role = 'member') => {
  db.run(
    `INSERT INTO room_members (room_id, user_id, role, last_read_message_id)
     VALUES (?, ?, ?, COALESCE((SELECT MAX(id) FROM messages WHERE room_id = ?), 0))
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    roomId,
    userId,
    role,
    roomId
  );
  return getMembership(roomId, userId);
};

const removeMember = (roomId, userId) =>
  db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId).changes;

const setMemberRole = (roomId, userId, role) => {
  db.run('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?', role, roomId, userId);
  return getMembership(roomId, userId);
};

const setMemberMute = (roomId, userId, mutedUntilIso) => {
  db.run(
    'UPDATE room_members SET muted_until = ? WHERE room_id = ? AND user_id = ?',
    mutedUntilIso,
    roomId,
    userId
  );
  return getMembership(roomId, userId);
};

const setMemberBanned = (roomId, userId, banned) => {
  db.run(
    'UPDATE room_members SET banned_at = ? WHERE room_id = ? AND user_id = ?',
    banned ? nowIso() : null,
    roomId,
    userId
  );
  return getMembership(roomId, userId);
};

const listMembers = (roomId) =>
  db
    .all(
      `SELECT ${MEMBER_COLUMNS}
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = ?
       ORDER BY
         CASE rm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
         u.username`,
      roomId
    )
    .map(toMember);

const listMemberIds = (roomId) =>
  db.all('SELECT user_id FROM room_members WHERE room_id = ?', roomId).map((row) => row.user_id);

const countMembers = (roomId) =>
  db.pluck('SELECT COUNT(*) FROM room_members WHERE room_id = ?', roomId);

// --- listings -----------------------------------------------------------

const unreadSummaryFor = (userId) => {
  const rows = db.all(
    `SELECT rm.room_id,
            COUNT(m.id) AS unread
     FROM room_members rm
     LEFT JOIN messages m
       ON m.room_id = rm.room_id
      AND m.id > rm.last_read_message_id
      AND m.deleted_at IS NULL
      AND (m.user_id IS NULL OR m.user_id != rm.user_id)
     WHERE rm.user_id = ?
     GROUP BY rm.room_id`,
    userId
  );

  const mentionRows = db.all(
    `SELECT m.room_id, COUNT(*) AS mentions
     FROM mentions mn
     JOIN messages m ON m.id = mn.message_id
     JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = mn.user_id
     WHERE mn.user_id = ? AND m.id > rm.last_read_message_id AND m.deleted_at IS NULL
     GROUP BY m.room_id`,
    userId
  );

  const mentionByRoom = new Map(mentionRows.map((row) => [row.room_id, row.mentions]));
  return new Map(
    rows.map((row) => [row.room_id, { unread: row.unread, mentions: mentionByRoom.get(row.room_id) || 0 }])
  );
};

/**
 * Rooms and DMs the user belongs to, with unread counts and enough of the last
 * message to render the sidebar without a second round trip.
 */
const listForUser = (userId) => {
  const rows = db.all(
    `SELECT r.*,
            rm.role AS room_role,
            rm.last_read_message_id,
            last.id         AS last_message_id,
            last.body       AS last_message_body,
            last.created_at AS last_message_at,
            last.kind       AS last_message_kind,
            last.deleted_at AS last_message_deleted_at,
            lu.username     AS last_message_username
     FROM room_members rm
     JOIN rooms r ON r.id = rm.room_id
     LEFT JOIN messages last ON last.id = (
       SELECT id FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1
     )
     LEFT JOIN users lu ON lu.id = last.user_id
     WHERE rm.user_id = ? AND rm.banned_at IS NULL
     ORDER BY COALESCE(last.created_at, r.created_at) DESC`,
    userId
  );

  const unread = unreadSummaryFor(userId);
  const dmRoomIds = rows.filter((row) => row.kind === 'dm').map((row) => row.id);
  const partners = dmPartnersFor(dmRoomIds, userId);

  return rows.map((row) => {
    const counts = unread.get(row.id) || { unread: 0, mentions: 0 };
    return {
      ...toRoom(row),
      roomRole: row.room_role,
      lastReadMessageId: row.last_read_message_id,
      unreadCount: counts.unread,
      mentionCount: counts.mentions,
      partner: partners.get(row.id) || null,
      lastMessage: row.last_message_id
        ? {
            id: row.last_message_id,
            body: row.last_message_deleted_at ? 'Message deleted' : row.last_message_body,
            username: row.last_message_username || null,
            kind: row.last_message_kind,
            createdAt: row.last_message_at,
          }
        : null,
    };
  });
};

/** For each DM room, the other participant. */
const dmPartnersFor = (roomIds, userId) => {
  if (roomIds.length === 0) return new Map();
  const placeholders = roomIds.map(() => '?').join(',');
  const rows = db.all(
    `SELECT rm.room_id, u.id, u.username, u.display_name, u.avatar_path, u.avatar_color,
            u.presence, u.status_message, u.role, u.bio, u.created_at, u.last_seen_at,
            u.muted_until, u.banned_at, u.banned_reason
     FROM room_members rm
     JOIN users u ON u.id = rm.user_id
     WHERE rm.room_id IN (${placeholders}) AND rm.user_id != ?`,
    ...roomIds,
    userId
  );
  return new Map(rows.map((row) => [row.room_id, users.toPublicUser(row)]));
};

/** Public rooms for the browse dialog, flagged with whether the user is already in. */
const listPublicRooms = (userId, { query = '', limit = 50 } = {}) => {
  const like = `%${query}%`;
  const rows = db.all(
    `SELECT r.*,
            (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS member_count,
            (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.deleted_at IS NULL) AS message_count,
            EXISTS (SELECT 1 FROM room_members rm2 WHERE rm2.room_id = r.id AND rm2.user_id = ?) AS is_member
     FROM rooms r
     WHERE r.kind = 'room' AND r.archived_at IS NULL
       AND (r.visibility = 'public' OR EXISTS (
             SELECT 1 FROM room_members rm3 WHERE rm3.room_id = r.id AND rm3.user_id = ?))
       AND (? = '' OR r.name LIKE ? OR r.topic LIKE ? OR r.slug LIKE ?)
     ORDER BY member_count DESC, r.name
     LIMIT ?`,
    userId,
    userId,
    query,
    like,
    like,
    like,
    limit
  );

  return rows.map((row) => ({
    ...toRoom(row),
    memberCount: row.member_count,
    messageCount: row.message_count,
    isMember: Boolean(row.is_member),
  }));
};

const listAllRooms = ({ limit = 200 } = {}) =>
  db
    .all(
      `SELECT r.*,
              (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS member_count,
              (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.deleted_at IS NULL) AS message_count
       FROM rooms r
       ORDER BY r.created_at DESC
       LIMIT ?`,
      limit
    )
    .map((row) => ({
      ...toRoom(row),
      memberCount: row.member_count,
      messageCount: row.message_count,
    }));

const countRooms = ({ kind = null } = {}) =>
  kind
    ? db.pluck('SELECT COUNT(*) FROM rooms WHERE kind = ?', kind)
    : db.pluck('SELECT COUNT(*) FROM rooms');

const markRead = (roomId, userId, messageId) => {
  db.run(
    `UPDATE room_members
     SET last_read_message_id = MAX(last_read_message_id, ?)
     WHERE room_id = ? AND user_id = ?`,
    messageId,
    roomId,
    userId
  );
};

// --- direct messages ----------------------------------------------------

const findDmBetween = (userA, userB) =>
  toRoom(db.get('SELECT * FROM rooms WHERE dm_key = ?', dmKeyFor(userA, userB)));

const findOrCreateDm = db.transaction((userA, userB) => {
  const existing = findDmBetween(userA, userB);
  if (existing) return existing;

  const key = dmKeyFor(userA, userB);
  const { lastInsertRowid } = db.run(
    `INSERT INTO rooms (slug, name, topic, kind, visibility, dm_key, created_by)
     VALUES (?, ?, '', 'dm', 'private', ?, ?)`,
    `dm-${key.replace(':', '-')}`,
    'Direct message',
    key,
    userA
  );
  const roomId = Number(lastInsertRowid);
  addMember(roomId, userA, 'member');
  addMember(roomId, userB, 'member');
  return findById(roomId);
});

// --- invites ------------------------------------------------------------

const toInvite = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    maxUses: row.max_uses || null,
    uses: row.uses,
    revokedAt: row.revoked_at || null,
  };
};

const createInvite = (roomId, createdBy, { expiresInMinutes = null, maxUses = null } = {}) => {
  const code = randomToken(9);
  const expiresAt = expiresInMinutes
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
    : null;
  const { lastInsertRowid } = db.run(
    'INSERT INTO invites (room_id, code, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)',
    roomId,
    code,
    createdBy,
    expiresAt,
    maxUses
  );
  return toInvite(db.get('SELECT * FROM invites WHERE id = ?', Number(lastInsertRowid)));
};

const findInviteByCode = (code) => toInvite(db.get('SELECT * FROM invites WHERE code = ?', code));

const listInvites = (roomId) =>
  db.all('SELECT * FROM invites WHERE room_id = ? ORDER BY created_at DESC', roomId).map(toInvite);

const consumeInvite = (code) => db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', code).changes;

const revokeInvite = (code) =>
  db.run('UPDATE invites SET revoked_at = ? WHERE code = ?', nowIso(), code).changes;

const inviteUsable = (invite) => {
  if (!invite) return false;
  if (invite.revokedAt) return false;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return false;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return false;
  return true;
};

module.exports = {
  toRoom,
  dmKeyFor,
  findById,
  findBySlug,
  findPasswordHash,
  uniqueSlug,
  createRoom,
  updateRoom,
  setPasswordHash,
  archiveRoom,
  deleteRoom,
  getMembership,
  isMember,
  addMember,
  removeMember,
  setMemberRole,
  setMemberMute,
  setMemberBanned,
  listMembers,
  listMemberIds,
  countMembers,
  listForUser,
  listPublicRooms,
  listAllRooms,
  countRooms,
  markRead,
  unreadSummaryFor,
  findDmBetween,
  findOrCreateDm,
  createInvite,
  findInviteByCode,
  listInvites,
  consumeInvite,
  revokeInvite,
  inviteUsable,
};
