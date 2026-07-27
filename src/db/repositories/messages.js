'use strict';

const config = require('../../config');
const db = require('../index');
const { excerpt } = require('../../lib/text');

const nowIso = () => new Date().toISOString();

// Sentinels wrap FTS snippet hits. They are control characters that cannot
// appear in a message body, so the client can split on them and build
// highlighted nodes without ever parsing markup.
const SNIPPET_OPEN = '';
const SNIPPET_CLOSE = '';

const BASE_SELECT = `
  SELECT m.*,
         u.username     AS author_username,
         u.display_name AS author_display_name,
         u.avatar_path  AS author_avatar_path,
         u.avatar_color AS author_avatar_color,
         u.role         AS author_role,
         a.id            AS att_id,
         a.stored_name   AS att_stored_name,
         a.original_name AS att_original_name,
         a.mime_type     AS att_mime_type,
         a.byte_size     AS att_byte_size,
         a.kind          AS att_kind,
         p.id            AS parent_id_resolved,
         p.body          AS parent_body,
         p.kind          AS parent_kind,
         p.author_label  AS parent_author_label,
         p.deleted_at    AS parent_deleted_at,
         pu.username     AS parent_username,
         pu.display_name AS parent_display_name,
         lp.status       AS lp_status,
         lp.title        AS lp_title,
         lp.description  AS lp_description,
         lp.image_url    AS lp_image_url,
         lp.site_name    AS lp_site_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.user_id
  LEFT JOIN attachments a ON a.id = m.attachment_id
  LEFT JOIN messages p ON p.id = m.parent_id
  LEFT JOIN users pu ON pu.id = p.user_id
  LEFT JOIN link_previews lp ON lp.url = m.link_url
`;

const toAttachment = (row) => {
  if (!row.att_id) return null;
  return {
    id: row.att_id,
    url: `${config.uploads.publicPath}/${row.att_stored_name}`,
    name: row.att_original_name,
    mimeType: row.att_mime_type,
    size: row.att_byte_size,
    kind: row.att_kind,
  };
};

const toParent = (row) => {
  if (!row.parent_id_resolved) return null;
  const label =
    row.parent_kind === 'user'
      ? row.parent_display_name || row.parent_username || 'Unknown'
      : row.parent_author_label || 'Bot';
  return {
    id: row.parent_id_resolved,
    author: label,
    excerpt: row.parent_deleted_at ? 'Message deleted' : excerpt(row.parent_body, 120),
    isDeleted: Boolean(row.parent_deleted_at),
  };
};

const toLinkPreview = (row) => {
  if (!row.link_url || row.lp_status !== 'ok') return null;
  return {
    url: row.link_url,
    title: row.lp_title || null,
    description: row.lp_description || null,
    imageUrl: row.lp_image_url || null,
    siteName: row.lp_site_name || null,
  };
};

const toMessage = (row) => ({
  id: row.id,
  roomId: row.room_id,
  kind: row.kind,
  body: row.deleted_at ? '' : row.body,
  createdAt: row.created_at,
  editedAt: row.edited_at || null,
  isDeleted: Boolean(row.deleted_at),
  pinnedAt: row.pinned_at || null,
  author:
    row.kind === 'user' && row.user_id
      ? {
          id: row.user_id,
          username: row.author_username,
          displayName: row.author_display_name || row.author_username,
          avatarUrl: row.author_avatar_path || null,
          avatarColor: row.author_avatar_color,
          role: row.author_role,
        }
      : null,
  authorLabel: row.author_label || null,
  parent: toParent(row),
  attachment: row.deleted_at ? null : toAttachment(row),
  linkPreview: row.deleted_at ? null : toLinkPreview(row),
  reactions: [],
  replyCount: 0,
  mentionedUserIds: [],
});

/** Attaches reactions, reply counts and mentions to a page of messages in three queries. */
const hydrate = (rows) => {
  const messages = rows.map(toMessage);
  if (messages.length === 0) return messages;

  const byId = new Map(messages.map((message) => [message.id, message]));
  const ids = [...byId.keys()];
  const placeholders = ids.map(() => '?').join(',');

  for (const reaction of db.all(
    `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders})
     ORDER BY created_at`,
    ...ids
  )) {
    const message = byId.get(reaction.message_id);
    let entry = message.reactions.find((item) => item.emoji === reaction.emoji);
    if (!entry) {
      entry = { emoji: reaction.emoji, count: 0, userIds: [] };
      message.reactions.push(entry);
    }
    entry.count += 1;
    entry.userIds.push(reaction.user_id);
  }

  for (const row of db.all(
    `SELECT parent_id, COUNT(*) AS replies FROM messages
     WHERE parent_id IN (${placeholders}) AND deleted_at IS NULL
     GROUP BY parent_id`,
    ...ids
  )) {
    byId.get(row.parent_id).replyCount = row.replies;
  }

  for (const row of db.all(
    `SELECT message_id, user_id FROM mentions WHERE message_id IN (${placeholders})`,
    ...ids
  )) {
    byId.get(row.message_id).mentionedUserIds.push(row.user_id);
  }

  return messages;
};

const getById = (id) => {
  const row = db.get(`${BASE_SELECT} WHERE m.id = ?`, id);
  if (!row) return null;
  return hydrate([row])[0];
};

const getRawById = (id) => db.get('SELECT * FROM messages WHERE id = ?', id);

const create = db.transaction(
  ({
    roomId,
    userId = null,
    body,
    parentId = null,
    kind = 'user',
    authorLabel = null,
    attachmentId = null,
    linkUrl = null,
    mentionUserIds = [],
  }) => {
    const { lastInsertRowid } = db.run(
      `INSERT INTO messages (room_id, user_id, parent_id, kind, body, author_label, attachment_id, link_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      roomId,
      userId,
      parentId,
      kind,
      body,
      authorLabel,
      attachmentId,
      linkUrl
    );

    const id = Number(lastInsertRowid);
    for (const mentionedId of new Set(mentionUserIds)) {
      db.run('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', id, mentionedId);
    }
    return id;
  }
);

const createAndReturn = (input) => getById(create(input));

/**
 * One page of room history, oldest-first, ending just before `beforeId`.
 * Passing the oldest id currently on screen walks backwards for infinite scroll.
 */
const listForRoom = (roomId, { beforeId = null, limit = config.chat.historyPageSize } = {}) => {
  const capped = Math.min(Math.max(limit, 1), config.chat.maxHistoryPageSize);
  const rows = beforeId
    ? db.all(
        `${BASE_SELECT} WHERE m.room_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
        roomId,
        beforeId,
        capped + 1
      )
    : db.all(`${BASE_SELECT} WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`, roomId, capped + 1);

  const hasMore = rows.length > capped;
  const page = hasMore ? rows.slice(0, capped) : rows;
  return { messages: hydrate(page).reverse(), hasMore };
};

const listThread = (parentId) => {
  const rows = db.all(`${BASE_SELECT} WHERE m.parent_id = ? ORDER BY m.id ASC`, parentId);
  return hydrate(rows);
};

const updateBody = (id, body) => {
  db.run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', body, nowIso(), id);
  db.run('DELETE FROM mentions WHERE message_id = ?', id);
  return getById(id);
};

const replaceMentions = (id, mentionUserIds) => {
  db.run('DELETE FROM mentions WHERE message_id = ?', id);
  for (const mentionedId of new Set(mentionUserIds)) {
    db.run('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', id, mentionedId);
  }
};

/** Soft delete: the row stays so thread parents and counts survive. */
const softDelete = (id) => {
  db.run(
    "UPDATE messages SET deleted_at = ?, body = '', attachment_id = NULL, link_url = NULL, pinned_at = NULL WHERE id = ?",
    nowIso(),
    id
  );
  db.run('DELETE FROM mentions WHERE message_id = ?', id);
  db.run('DELETE FROM reactions WHERE message_id = ?', id);
  return getById(id);
};

const setPinned = (id, userId, pinned) => {
  db.run(
    'UPDATE messages SET pinned_at = ?, pinned_by = ? WHERE id = ?',
    pinned ? nowIso() : null,
    pinned ? userId : null,
    id
  );
  return getById(id);
};

const listPinned = (roomId) => {
  const rows = db.all(
    `${BASE_SELECT} WHERE m.room_id = ? AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL
     ORDER BY m.pinned_at DESC`,
    roomId
  );
  return hydrate(rows);
};

const countPinned = (roomId) =>
  db.pluck(
    'SELECT COUNT(*) FROM messages WHERE room_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL',
    roomId
  );

const latestId = (roomId) =>
  db.pluck('SELECT COALESCE(MAX(id), 0) FROM messages WHERE room_id = ?', roomId);

/**
 * FTS5 query strings are user input, so anything that could be read as query
 * syntax is stripped and each remaining term becomes a prefix match.
 */
const toMatchQuery = (raw) => {
  const terms = String(raw)
    .replace(/["*()^:]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !/^(AND|OR|NOT|NEAR)$/i.test(term));

  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(' AND ');
};

const search = (roomId, rawQuery, { limit = config.chat.searchPageSize, offset = 0 } = {}) => {
  const match = toMatchQuery(rawQuery);
  if (!match) return { results: [], hasMore: false };

  const rows = db.all(
    `SELECT m.id, m.room_id, m.created_at, m.user_id, m.kind, m.author_label,
            u.username, u.display_name, u.avatar_color, u.avatar_path,
            snippet(messages_fts, 0, ?, ?, '…', 14) AS snippet
     FROM messages_fts
     JOIN messages m ON m.id = messages_fts.rowid
     LEFT JOIN users u ON u.id = m.user_id
     WHERE messages_fts MATCH ? AND m.room_id = ? AND m.deleted_at IS NULL
     ORDER BY rank
     LIMIT ? OFFSET ?`,
    SNIPPET_OPEN,
    SNIPPET_CLOSE,
    match,
    roomId,
    limit + 1,
    offset
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    hasMore,
    results: page.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      createdAt: row.created_at,
      snippet: row.snippet,
      author:
        row.kind === 'user' && row.user_id
          ? {
              id: row.user_id,
              username: row.username,
              displayName: row.display_name || row.username,
              avatarColor: row.avatar_color,
              avatarUrl: row.avatar_path || null,
            }
          : { id: null, username: row.author_label || 'Bot', displayName: row.author_label || 'Bot' },
    })),
  };
};

// --- reactions ----------------------------------------------------------

const addReaction = (messageId, userId, emoji) => {
  db.run(
    'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
    messageId,
    userId,
    emoji
  );
  return listReactions(messageId);
};

const removeReaction = (messageId, userId, emoji) => {
  db.run(
    'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    messageId,
    userId,
    emoji
  );
  return listReactions(messageId);
};

const hasReaction = (messageId, userId, emoji) =>
  Boolean(
    db.get(
      'SELECT 1 AS hit FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      messageId,
      userId,
      emoji
    )
  );

const listReactions = (messageId) => {
  const rows = db.all(
    'SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY created_at',
    messageId
  );
  const grouped = [];
  for (const row of rows) {
    let entry = grouped.find((item) => item.emoji === row.emoji);
    if (!entry) {
      entry = { emoji: row.emoji, count: 0, userIds: [] };
      grouped.push(entry);
    }
    entry.count += 1;
    entry.userIds.push(row.user_id);
  }
  return grouped;
};

const attachLinkUrl = (messageId, url) => {
  db.run('UPDATE messages SET link_url = ? WHERE id = ?', url, messageId);
};

const countMessages = () => db.pluck('SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL');

const countSince = (isoTime) =>
  db.pluck('SELECT COUNT(*) FROM messages WHERE created_at >= ?', isoTime);

module.exports = {
  SNIPPET_OPEN,
  SNIPPET_CLOSE,
  toMatchQuery,
  hydrate,
  getById,
  getRawById,
  create,
  createAndReturn,
  listForRoom,
  listThread,
  updateBody,
  replaceMentions,
  softDelete,
  setPinned,
  listPinned,
  countPinned,
  latestId,
  search,
  addReaction,
  removeReaction,
  hasReaction,
  listReactions,
  attachLinkUrl,
  countMessages,
  countSince,
};
