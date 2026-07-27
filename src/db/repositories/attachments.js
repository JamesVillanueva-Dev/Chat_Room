'use strict';

const config = require('../../config');
const db = require('../index');

const toAttachment = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    uploaderId: row.uploader_id,
    url: `${config.uploads.publicPath}/${row.stored_name}`,
    storedName: row.stored_name,
    name: row.original_name,
    mimeType: row.mime_type,
    size: row.byte_size,
    kind: row.kind,
    createdAt: row.created_at,
  };
};

const create = ({ uploaderId, storedName, originalName, mimeType, byteSize, kind }) => {
  const { lastInsertRowid } = db.run(
    `INSERT INTO attachments (uploader_id, stored_name, original_name, mime_type, byte_size, kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
    uploaderId,
    storedName,
    originalName,
    mimeType,
    byteSize,
    kind
  );
  return findById(Number(lastInsertRowid));
};

const findById = (id) => toAttachment(db.get('SELECT * FROM attachments WHERE id = ?', id));

const deleteById = (id) => db.run('DELETE FROM attachments WHERE id = ?', id).changes;

const countAttachments = () => db.pluck('SELECT COUNT(*) FROM attachments');

module.exports = { toAttachment, create, findById, deleteById, countAttachments };
