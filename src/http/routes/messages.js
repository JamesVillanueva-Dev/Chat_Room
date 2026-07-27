'use strict';

const express = require('express');

const attachmentsRepo = require('../../db/repositories/attachments');
const messagesRepo = require('../../db/repositories/messages');
const metrics = require('../../services/metrics');
const permissions = require('../../services/permissions');
const validate = require('../../lib/validate');
const { asyncHandler, requireAuth } = require('../middleware');
const { attachmentUpload, isImage } = require('../uploads');
const { NotFoundError, ValidationError } = require('../../lib/errors');

const router = express.Router();

router.use(requireAuth);

/**
 * Uploads are stored first and referenced by id when the message is sent, so a
 * large file does not have to travel over the websocket.
 */
router.post(
  '/uploads',
  attachmentUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError('No file was uploaded.', 'file');

    const attachment = attachmentsRepo.create({
      uploaderId: req.user.id,
      storedName: req.file.filename,
      originalName: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype,
      byteSize: req.file.size,
      kind: isImage(req.file.mimetype) ? 'image' : 'file',
    });

    metrics.increment('uploads');
    res.status(201).json({ attachment });
  })
);

router.get('/:id', (req, res) => {
  const message = messagesRepo.getById(validate.positiveInt(req.params.id, 'id'));
  if (!message) throw new NotFoundError('That message no longer exists.');
  permissions.assertCanView(req.user, message.roomId);
  res.json({ message });
});

/** A parent message plus every reply, for the thread panel. */
router.get('/:id/thread', (req, res) => {
  const messageId = validate.positiveInt(req.params.id, 'id');
  const parent = messagesRepo.getById(messageId);
  if (!parent) throw new NotFoundError('That message no longer exists.');
  permissions.assertCanView(req.user, parent.roomId);

  res.json({ parent, replies: messagesRepo.listThread(messageId) });
});

module.exports = router;
