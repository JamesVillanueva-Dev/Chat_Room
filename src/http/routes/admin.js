'use strict';

const express = require('express');

const attachmentsRepo = require('../../db/repositories/attachments');
const messagesRepo = require('../../db/repositories/messages');
const moderationLog = require('../../db/repositories/moderation');
const rooms = require('../../db/repositories/rooms');
const users = require('../../db/repositories/users');
const metrics = require('../../services/metrics');
const moderationService = require('../../services/moderationService');
const validate = require('../../lib/validate');
const { asyncHandler, requireAdmin } = require('../middleware');

const router = express.Router();

router.use(requireAdmin);

/** Everything the admin panel needs in one request. */
router.get('/overview', (req, res) => {
  res.json({
    stats: {
      users: users.countUsers(),
      rooms: rooms.countRooms({ kind: 'room' }),
      messages: messagesRepo.countMessages(),
      attachments: attachmentsRepo.countAttachments(),
      moderationActions: moderationLog.countEntries(),
    },
    metrics: metrics.snapshot(),
    users: users.listUsers({ limit: 200 }),
    rooms: rooms.listAllRooms({ limit: 200 }),
    recentActions: moderationLog.listRecent({ limit: 40 }),
  });
});

router.get('/users', (req, res) => {
  const query = String(req.query.query || '').trim();
  res.json({ users: users.listUsers({ query, limit: 200 }) });
});

router.post(
  '/users/:id/ban',
  asyncHandler(async (req, res) => {
    const outcome = moderationService.ban({
      actor: req.user,
      target: validate.positiveInt(req.params.id, 'id'),
      reason: String(req.body?.reason || ''),
    });
    res.json({ user: users.findById(outcome.target.id) });
  })
);

router.post(
  '/users/:id/unban',
  asyncHandler(async (req, res) => {
    const outcome = moderationService.unban({
      actor: req.user,
      target: validate.positiveInt(req.params.id, 'id'),
    });
    res.json({ user: users.findById(outcome.target.id) });
  })
);

router.post(
  '/users/:id/mute',
  asyncHandler(async (req, res) => {
    const outcome = moderationService.mute({
      actor: req.user,
      target: validate.positiveInt(req.params.id, 'id'),
      minutes: req.body?.minutes,
      reason: String(req.body?.reason || ''),
    });
    res.json({ user: users.findById(outcome.target.id), mutedUntil: outcome.until });
  })
);

router.post(
  '/users/:id/unmute',
  asyncHandler(async (req, res) => {
    const outcome = moderationService.unmute({
      actor: req.user,
      target: validate.positiveInt(req.params.id, 'id'),
    });
    res.json({ user: users.findById(outcome.target.id) });
  })
);

router.post(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const user = moderationService.setGlobalRole({
      actor: req.user,
      target: validate.positiveInt(req.params.id, 'id'),
      role: req.body?.role,
    });
    res.json({ user });
  })
);

router.get('/moderation-log', (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  const offset = Number.parseInt(req.query.offset, 10) || 0;
  res.json({ entries: moderationLog.listRecent({ limit, offset }) });
});

module.exports = router;
