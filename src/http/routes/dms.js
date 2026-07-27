'use strict';

const express = require('express');

const rooms = require('../../db/repositories/rooms');
const users = require('../../db/repositories/users');
const validate = require('../../lib/validate');
const { bus, EVENTS } = require('../../services/events');
const { requireAuth } = require('../middleware');
const { NotFoundError, ValidationError } = require('../../lib/errors');

const router = express.Router();

router.use(requireAuth);

/** Opens the conversation with another user, creating it on first use. */
router.post('/', (req, res) => {
  const targetId = validate.positiveInt(req.body?.userId, 'userId');
  if (targetId === req.user.id) {
    throw new ValidationError('You cannot start a direct message with yourself.', 'userId');
  }

  const target = users.findById(targetId);
  if (!target) throw new NotFoundError('No such user.');
  if (target.isBanned) throw new NotFoundError('No such user.');

  const existing = rooms.findDmBetween(req.user.id, targetId);
  const room = existing || rooms.findOrCreateDm(req.user.id, targetId);

  if (!existing) {
    bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId: room.id, joinedUserId: targetId });
  }

  res.status(existing ? 200 : 201).json({ room: { ...room, partner: target, roomRole: 'member' } });
});

module.exports = router;
