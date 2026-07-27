'use strict';

const express = require('express');

const config = require('../../config');
const users = require('../../db/repositories/users');
const validate = require('../../lib/validate');
const { bus, EVENTS } = require('../../services/events');
const { asyncHandler, requireAuth } = require('../middleware');
const { avatarUpload, removeFile } = require('../uploads');
const { NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.use(requireAuth);

/** Backs @mention autocomplete and the "start a DM" picker. */
router.get('/', (req, res) => {
  const query = String(req.query.query || '').trim();
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 10, 25);
  const results = query ? users.searchByPrefix(query, limit) : users.listUsers({ limit });
  res.json({ users: results });
});

router.get('/:id', (req, res) => {
  const user = users.findById(validate.positiveInt(req.params.id, 'id'));
  if (!user) throw new NotFoundError('No such user.');
  res.json({ user });
});

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const updates = {};

    if (req.body.displayName !== undefined) {
      updates.displayName =
        validate.boundedText(req.body.displayName, {
          field: 'displayName',
          max: config.chat.maxUsernameLength,
        }) || req.user.username;
    }
    if (req.body.bio !== undefined) {
      updates.bio = validate.boundedText(req.body.bio, { field: 'bio', max: config.chat.maxBioLength });
    }
    if (req.body.statusMessage !== undefined) {
      updates.statusMessage = validate.boundedText(req.body.statusMessage, {
        field: 'statusMessage',
        max: config.chat.maxStatusMessageLength,
      });
    }
    if (req.body.presence !== undefined) {
      updates.presence = validate.presence(req.body.presence);
    }

    const user = users.updateProfile(req.user.id, updates);
    bus.emit(EVENTS.USER_UPDATED, user);
    res.json({ user });
  })
);

router.post(
  '/me/avatar',
  avatarUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new NotFoundError('No image was uploaded.');

    const previous = req.user.avatarUrl;
    const user = users.setAvatarPath(req.user.id, `${config.uploads.publicPath}/${req.file.filename}`);

    // The old avatar is unreferenced now.
    if (previous) removeFile(previous.split('/').pop());

    bus.emit(EVENTS.USER_UPDATED, user);
    res.json({ user });
  })
);

router.delete('/me/avatar', (req, res) => {
  const previous = req.user.avatarUrl;
  const user = users.setAvatarPath(req.user.id, null);
  if (previous) removeFile(previous.split('/').pop());
  bus.emit(EVENTS.USER_UPDATED, user);
  res.json({ user });
});

module.exports = router;
