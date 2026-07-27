-- Core chat schema: identities, rooms, membership, messages and their satellites.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  avatar_path    TEXT,
  avatar_color   TEXT NOT NULL DEFAULT '#5b8def',
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  presence       TEXT NOT NULL DEFAULT 'offline'
                 CHECK (presence IN ('online', 'away', 'busy', 'offline')),
  status_message TEXT NOT NULL DEFAULT '',
  muted_until    TEXT,
  banned_at      TEXT,
  banned_reason  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at   TEXT
);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('image', 'file')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE rooms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  topic         TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'dm')),
  visibility    TEXT NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public', 'private')),
  password_hash TEXT,
  -- For DMs: the two member ids sorted and joined, so the pair is unique.
  dm_key        TEXT UNIQUE,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at   TEXT
);

CREATE TABLE room_members (
  room_id              INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL DEFAULT 'member'
                       CHECK (role IN ('member', 'moderator', 'owner')),
  joined_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  muted_until          TEXT,
  banned_at            TEXT,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'user'
                CHECK (kind IN ('user', 'system', 'bot')),
  body          TEXT NOT NULL DEFAULT '',
  author_label  TEXT,
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  link_url      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  edited_at     TEXT,
  deleted_at    TEXT,
  pinned_at     TEXT,
  pinned_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE mentions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  max_uses   INTEGER,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

CREATE TABLE moderation_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room_id        INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE link_previews (
  url         TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'empty', 'error')),
  title       TEXT,
  description TEXT,
  image_url   TEXT,
  site_name   TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  sid        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data       TEXT NOT NULL
);

CREATE INDEX idx_messages_room_id ON messages (room_id, id DESC);
CREATE INDEX idx_messages_parent ON messages (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_messages_pinned ON messages (room_id, pinned_at) WHERE pinned_at IS NOT NULL;
CREATE INDEX idx_room_members_user ON room_members (user_id);
CREATE INDEX idx_reactions_message ON reactions (message_id);
CREATE INDEX idx_mentions_user ON mentions (user_id);
CREATE INDEX idx_invites_room ON invites (room_id);
CREATE INDEX idx_moderation_created ON moderation_log (created_at DESC);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
