'use strict';

const express = require('express');

const rooms = require('../../db/repositories/rooms');
const chat = require('../../services/chat');
const { bus, EVENTS } = require('../../services/events');
const { requireAuth } = require('../middleware');
const { ForbiddenError, NotFoundError } = require('../../lib/errors');

const router = express.Router();

router.use(requireAuth);

const loadUsableInvite = (code) => {
  const invite = rooms.findInviteByCode(code);
  if (!invite) throw new NotFoundError('That invite link is not valid.');
  if (!rooms.inviteUsable(invite)) {
    throw new ForbiddenError('That invite link has expired or been used up.');
  }
  return invite;
};

/** Preview before accepting, so the client can show what it is joining. */
router.get('/:code', (req, res) => {
  const invite = loadUsableInvite(req.params.code);
  const room = rooms.findById(invite.roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');

  res.json({
    room: { id: room.id, name: room.name, topic: room.topic, visibility: room.visibility },
    memberCount: rooms.countMembers(room.id),
    alreadyMember: rooms.isMember(room.id, req.user.id),
  });
});

router.post('/:code/accept', (req, res) => {
  const invite = loadUsableInvite(req.params.code);
  const room = rooms.findById(invite.roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');

  const existing = rooms.getMembership(room.id, req.user.id);
  if (existing?.banned_at) throw new ForbiddenError('You are banned from this room.');

  if (existing) {
    return res.json({ room: { ...room, roomRole: existing.role }, alreadyMember: true });
  }

  rooms.addMember(room.id, req.user.id);
  rooms.consumeInvite(invite.code);
  chat.postSystemMessage(room.id, `${req.user.username} joined via an invite link.`);
  bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId: room.id, joinedUserId: req.user.id });

  return res.status(201).json({ room: { ...room, roomRole: 'member' } });
});

module.exports = router;
