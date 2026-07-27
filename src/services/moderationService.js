'use strict';

const { sessionStore } = require('../auth/session');
const moderationLog = require('../db/repositories/moderation');
const rooms = require('../db/repositories/rooms');
const users = require('../db/repositories/users');
const chat = require('./chat');
const logger = require('../logger').child({ component: 'moderation' });
const permissions = require('./permissions');
const { bus, EVENTS } = require('./events');
const { NotFoundError, ValidationError } = require('../lib/errors');

const MAX_MUTE_MINUTES = 60 * 24 * 7;

const requireTarget = (identifier) => {
  const target =
    typeof identifier === 'number'
      ? users.findById(identifier)
      : users.findByUsername(String(identifier).replace(/^@/, ''));
  if (!target) throw new NotFoundError('No such user.');
  return target;
};

const requireMinutes = (value, fallback = 10) => {
  if (value === undefined || value === null || value === '') return fallback;
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new ValidationError('Duration must be a positive number of minutes.', 'minutes');
  }
  return Math.min(minutes, MAX_MUTE_MINUTES);
};

const announce = (roomId, text) => {
  if (roomId) chat.postSystemMessage(roomId, text);
};

const record = (entry) => {
  moderationLog.log(entry);
  bus.emit(EVENTS.MODERATION, entry);
  logger.info('moderation action', {
    action: entry.action,
    actorId: entry.actorId,
    targetId: entry.targetUserId,
    roomId: entry.roomId,
  });
};

/**
 * Mutes a user in one room, or server-wide when no room is given.
 * Room mutes need room moderator rights; a global mute needs admin.
 */
const mute = ({ actor, target: identifier, roomId = null, minutes, reason = '' }) => {
  const target = requireTarget(identifier);
  const durationMinutes = requireMinutes(minutes);
  const until = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  permissions.assertCanModerateUser(actor, target, roomId);

  if (roomId) {
    permissions.assertRoomModerator(actor, roomId);
    if (!rooms.getMembership(roomId, target.id)) {
      throw new NotFoundError(`${target.username} is not in this room.`);
    }
    rooms.setMemberMute(roomId, target.id, until);
  } else {
    permissions.assertAdmin(actor);
    users.setGlobalMute(target.id, until);
  }

  record({
    actorId: actor.id,
    targetUserId: target.id,
    roomId,
    action: roomId ? 'mute' : 'global-mute',
    reason,
    expiresAt: until,
  });

  const scope = roomId ? 'this room' : 'the server';
  announce(roomId, `${target.username} was muted in ${scope} for ${durationMinutes} minute(s) by ${actor.username}.`);

  return { target, until, minutes: durationMinutes };
};

const unmute = ({ actor, target: identifier, roomId = null }) => {
  const target = requireTarget(identifier);
  permissions.assertCanModerateUser(actor, target, roomId);

  if (roomId) {
    permissions.assertRoomModerator(actor, roomId);
    rooms.setMemberMute(roomId, target.id, null);
  } else {
    permissions.assertAdmin(actor);
    users.setGlobalMute(target.id, null);
  }

  record({
    actorId: actor.id,
    targetUserId: target.id,
    roomId,
    action: roomId ? 'unmute' : 'global-unmute',
  });
  announce(roomId, `${target.username} was unmuted by ${actor.username}.`);
  return { target };
};

/** Removes someone from a room. They may rejoin unless also banned. */
const kick = ({ actor, target: identifier, roomId, reason = '' }) => {
  if (!roomId) throw new ValidationError('Kicking happens inside a room.', 'roomId');
  const target = requireTarget(identifier);

  permissions.assertRoomModerator(actor, roomId);
  permissions.assertCanModerateUser(actor, target, roomId);

  if (!rooms.getMembership(roomId, target.id)) {
    throw new NotFoundError(`${target.username} is not in this room.`);
  }

  rooms.removeMember(roomId, target.id);
  record({ actorId: actor.id, targetUserId: target.id, roomId, action: 'kick', reason });

  announce(roomId, `${target.username} was removed from the room by ${actor.username}.`);
  bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId });
  bus.emit(EVENTS.FORCE_DISCONNECT, {
    userId: target.id,
    roomId,
    scope: 'room',
    reason: reason || 'You were removed from the room.',
  });

  return { target };
};

/**
 * Bans from a single room, or from the whole server when no room is given.
 * A global ban also ends the user's sessions so their tabs cannot keep acting.
 */
const ban = ({ actor, target: identifier, roomId = null, reason = '' }) => {
  const target = requireTarget(identifier);
  permissions.assertCanModerateUser(actor, target, roomId);

  if (roomId) {
    permissions.assertRoomModerator(actor, roomId);
    rooms.addMember(roomId, target.id);
    rooms.setMemberBanned(roomId, target.id, true);
    record({ actorId: actor.id, targetUserId: target.id, roomId, action: 'ban', reason });
    announce(roomId, `${target.username} was banned from the room by ${actor.username}.`);
    bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId });
    bus.emit(EVENTS.FORCE_DISCONNECT, {
      userId: target.id,
      roomId,
      scope: 'room',
      reason: reason || 'You were banned from this room.',
    });
    return { target, scope: 'room' };
  }

  permissions.assertAdmin(actor);
  users.setBanned(target.id, { banned: true, reason });
  record({ actorId: actor.id, targetUserId: target.id, roomId: null, action: 'global-ban', reason });

  // Kill every session so open tabs stop being authenticated.
  sessionStore.destroyForUser(target.id);

  bus.emit(EVENTS.FORCE_DISCONNECT, {
    userId: target.id,
    scope: 'server',
    reason: reason || 'You were banned from this server.',
  });

  return { target, scope: 'server' };
};

const unban = ({ actor, target: identifier, roomId = null }) => {
  const target = requireTarget(identifier);

  if (roomId) {
    permissions.assertRoomModerator(actor, roomId);
    rooms.setMemberBanned(roomId, target.id, false);
    record({ actorId: actor.id, targetUserId: target.id, roomId, action: 'unban' });
    announce(roomId, `${target.username} was unbanned by ${actor.username}.`);
    return { target, scope: 'room' };
  }

  permissions.assertAdmin(actor);
  users.setBanned(target.id, { banned: false });
  record({ actorId: actor.id, targetUserId: target.id, roomId: null, action: 'global-unban' });
  return { target, scope: 'server' };
};

const setGlobalRole = ({ actor, target: identifier, role }) => {
  permissions.assertAdmin(actor);
  if (!['user', 'admin'].includes(role)) {
    throw new ValidationError('Role must be user or admin.', 'role');
  }

  const target = requireTarget(identifier);
  if (target.id === actor.id) {
    throw new ValidationError('You cannot change your own role.', 'role');
  }

  const updated = users.setRole(target.id, role);
  record({ actorId: actor.id, targetUserId: target.id, action: `role:${role}` });
  bus.emit(EVENTS.USER_UPDATED, updated);
  return updated;
};

const setRoomRole = ({ actor, target: identifier, roomId, role }) => {
  permissions.assertRoomOwner(actor, roomId);
  if (!['member', 'moderator', 'owner'].includes(role)) {
    throw new ValidationError('Room role must be member, moderator or owner.', 'role');
  }

  const target = requireTarget(identifier);
  if (!rooms.getMembership(roomId, target.id)) {
    throw new NotFoundError(`${target.username} is not in this room.`);
  }

  rooms.setMemberRole(roomId, target.id, role);
  record({ actorId: actor.id, targetUserId: target.id, roomId, action: `room-role:${role}` });
  announce(roomId, `${target.username} is now a room ${role}.`);
  bus.emit(EVENTS.ROOM_MEMBERS_CHANGED, { roomId });
  return { target, role };
};

module.exports = {
  MAX_MUTE_MINUTES,
  requireTarget,
  mute,
  unmute,
  kick,
  ban,
  unban,
  setGlobalRole,
  setRoomRole,
};
