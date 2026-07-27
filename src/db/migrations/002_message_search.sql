-- Full-text search over message bodies. `messages` stays the source of truth;
-- the FTS index is an external-content mirror kept in sync by triggers.

CREATE VIRTUAL TABLE messages_fts USING fts5(
  body,
  content = 'messages',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO messages_fts (rowid, body) VALUES (new.id, new.body);
END;
