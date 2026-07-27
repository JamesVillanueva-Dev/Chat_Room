'use strict';

const express = require('express');

const config = require('../../config');
const messagesRepo = require('../../db/repositories/messages');
const rooms = require('../../db/repositories/rooms');
const users = require('../../db/repositories/users');
const chat = require('../../services/chat');
const moderationService = require('../../services/moderationService');
const passwords = require('../../auth/passwords');
const permissions = require('../../services/permissions');
const validate = require('../../lib/validate');
const { bus, EVENTS } = require('../../services/events');
const { asyncHandler, requireAuth } = require('../middleware');
const {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../../lib/errors');

const router = express.Router();

router.use(requireAuth);

const roomIdFrom = (req) => validate.positiveInt(req.params.id, 'roomId');

/** Sidebar: every room and DM the user belongs to, with unread counts. */
router.get('/', (req, res) => {
  res.json({ rooms: rooms.listForUser(req.user.id) });
});

router.get('/public', (req, res) => {
  const query = String(req.query.query || '').trim();
  res.json({ rooms: rooms.listPublicRooms(req.user.id, { query }) });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = validate.roomName(req.body?.name);
    const topic = validate.boundedText(req.body?.topic, {
      field: 'topic',
      max: config.chat.maxTopicLength,
    });
    const visibility = validate.visibility(req.body?.visibility || 'public');

    const rawPassword = req.body?.password;
    let passwordHash = null;
    if (rawPassword) {
      if (String(rawPassword).length < 4) {
        throw new ValidationError('Room password must be at least 4 characters.', 'password');
      }
      passwordHash = await passwords.hash(String(rawPassword));
    }

    const room = rooms.createRoom({
      name,
      topic,
      visibility,
      passwordHash,
      createdBy: req.user.id,
    });
    rooms.addMember(room.id, req.user.id, 'owner');
    chat.postSystemMessage(room.id, `${req.user.username} created ${room.name}.`);

    res.status(201).json({ room: { ...room, roomRole: 'owner' } });
  })
);

router.get('/:id', (req, res) => {
  const roomId = roomIdFrom(req);
  const room = permissions.assertCanView(req.user, roomId);
  const membership = rooms.getMembership(roomId, req.user.id);

  res.json({
    room,
    membership: membership
      ? { role: membership.role, lastReadMessageId: membership.last_read_message_id }
      : null,
    members: rooms.listMembers(roomId),
    pinned: messagesRepo.listPinned(roomId),
    canModerate: permissions.isRoomModerator(req.user, roomId),
  });
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const roomId = roomIdFrom(req);
    const existing = rooms.findById(roomId);
    if (!existing) throw new NotFoundError('That room no longer exists.');
    if (existing.kind === 'dm') throw new ForbiddenError('Direct messages cannot be edited.');
    permissions.assertRoomOwner(req.user, roomId);

    const updates = {};
    if (req.body.name !== undefined) updates.name = validate.roomName(req.body.name);
    if (req.body.topic !== undefined) {
      updates.topic = validate.boundedText(req.body.topic, {
        field: 'topic',
        max: config.chat.maxTopicLength,
      });
    }
    if (req.body.visibility !== undefined) updates.visibility = validate.visibility(req.body.visibility);

    if (req.body.password !== undefined) {
      const raw = req.body.password;
      if (!raw) {
        rooms.setPasswordHash(roomId, null);
      } else {
        if (String(raw).length < 4) {
          throw new ValidationError('Room password must be at least 4 characters.', 'password');
        }
        rooms.setPasswordHash(roomId, await passwords.hash(String(raw)));
      }
    }

    const room = rooms.updateRoom(roomId, updates);
    bus.emit(EVENTS.ROOM_UPDATED, room);
    res.json({ room });
  })
);

router.delete('/:id', (req, res) => {
  const roomId = roomIdFrom(req);
  const room = rooms.findById(roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');
  if (room.slug === config.chat.defaultRoomSlug) {
    throw new ForbiddenError('The default room cannot be deleted.');
  }
  if (room.kind === 'dm') throw new ForbiddenError('Direct messages cannot be deleted.');
  permissions.assertRoomOwner(req.user, roomId);

  const memberIds = rooms.listMemberIds(roomId);
  rooms.deleteRoom(roomId);
  bus.emit(EVENTS.ROOM_DELETED, { roomId, memberIds, name: room.name });
  res.status(204).end();
});

router.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const roomId = roomIdFrom(req);
    const room = rooms.findById(roomId);
    if (!room) throw new NotFoundError('That room no longer exists.');
    if (room.kind === 'dm') throw new ForbiddenError('Direct messages cannot be joined.');

    const existing = rooms.getMembership(roomId, req.user.id);
    if (existing?.banned_at) throw new ForbiddenError('You are banned from this room.');
    if (existing) return res.json({ room: { ...room, roomRole: existing.role }, alreadyMember: true });

    if (room.visibility === 'private') {
      throw new ForbiddenError('This room is invite only.');
    }
    if (room.hasPassword) {
      const matches = await passwords.verify(
        String(req.body?.password || ''),
        rooms.findPasswordHash(roomId)
      );
      if (!matches) throw new ForbiddenError('Incorrect room password.');
    }

    rooms.addMember(roomId, req.user.id);
    chat.postSystemMessage(roomId, `${req.user.username} joined the room.`);
    bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId, joinedUserId: req.user.id });

    return res.status(201).json({ room: { ...room, roomRole: 'member' } });
  })
);

router.post('/:id/leave', (req, res) => {
  const roomId = roomIdFrom(req);
  const room = rooms.findById(roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');
  if (room.slug === config.chat.defaultRoomSlug) {
    throw new ForbiddenError('You cannot leave the default room.');
  }

  if (!rooms.getMembership(roomId, req.user.id)) {
    throw new NotFoundError('You are not in that room.');
  }

  rooms.removeMember(roomId, req.user.id);
  chat.postSystemMessage(roomId, `${req.user.username} left the room.`);
  bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId, leftUserId: req.user.id });
  res.status(204).end();
});

/** History, newest page first; pass `before` to walk backwards. */
router.get('/:id/messages', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertCanView(req.user, roomId);

  const beforeId = validate.optionalId(req.query.before, 'before');
  const limit = req.query.limit
    ? validate.positiveInt(req.query.limit, 'limit', { max: config.chat.maxHistoryPageSize })
    : config.chat.historyPageSize;

  const { messages, hasMore } = messagesRepo.listForRoom(roomId, { beforeId, limit });
  res.json({ messages, hasMore });
});

router.get('/:id/search', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertCanView(req.user, roomId);

  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ results: [], hasMore: false });

  const offset = Number.parseInt(req.query.offset, 10) || 0;
  const outcome = messagesRepo.search(roomId, query, { offset });
  return res.json(outcome);
});

router.get('/:id/pinned', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertCanView(req.user, roomId);
  res.json({ pinned: messagesRepo.listPinned(roomId) });
});

router.get('/:id/members', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertCanView(req.user, roomId);
  res.json({ members: rooms.listMembers(roomId) });
});

router.post('/:id/read', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertCanView(req.user, roomId);
  const messageId = validate.positiveInt(req.body?.messageId, 'messageId');
  rooms.markRead(roomId, req.user.id, messageId);
  res.status(204).end();
});

router.post('/:id/members/:userId/role', (req, res) => {
  const roomId = roomIdFrom(req);
  const outcome = moderationService.setRoomRole({
    actor: req.user,
    target: validate.positiveInt(req.params.userId, 'userId'),
    roomId,
    role: req.body?.role,
  });
  res.json({ member: outcome.target, role: outcome.role });
});

// --- invites ------------------------------------------------------------

router.get('/:id/invites', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertRoomModerator(req.user, roomId);
  res.json({ invites: rooms.listInvites(roomId) });
});

router.post('/:id/invites', (req, res) => {
  const roomId = roomIdFrom(req);
  const room = rooms.findById(roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');
  permissions.assertRoomModerator(req.user, roomId);

  const invite = rooms.createInvite(roomId, req.user.id, {
    expiresInMinutes: req.body?.expiresInMinutes ? Number(req.body.expiresInMinutes) : null,
    maxUses: req.body?.maxUses ? Number(req.body.maxUses) : null,
  });

  res.status(201).json({ invite, url: `/invite/${invite.code}` });
});

router.delete('/:id/invites/:code', (req, res) => {
  const roomId = roomIdFrom(req);
  permissions.assertRoomModerator(req.user, roomId);
  const invite = rooms.findInviteByCode(req.params.code);
  if (!invite || invite.roomId !== roomId) throw new NotFoundError('No such invite.');
  rooms.revokeInvite(invite.code);
  res.status(204).end();
});

module.exports = router;
