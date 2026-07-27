'use strict';

const rooms = require('../db/repositories/rooms');
const users = require('../db/repositories/users');
const { ForbiddenError, NotFoundError } = require('../lib/errors');

const isAdmin = (user) => user?.role === 'admin';

const roomRoleOf = (user, roomId) => {
  if (!user) return null;
  return rooms.getMembership(roomId, user.id)?.role || null;
};

const isRoomModerator = (user, roomId) => {
  if (isAdmin(user)) return true;
  const role = roomRoleOf(user, roomId);
  return role === 'owner' || role === 'moderator';
};

const isRoomOwner = (user, roomId) => isAdmin(user) || roomRoleOf(user, roomId) === 'owner';

const mutedUntilFor = (user, roomId) => {
  const globalMute = users.findById(user.id)?.mutedUntil;
  const membership = rooms.getMembership(roomId, user.id);
  const roomMute = membership?.muted_until || null;

  const candidates = [globalMute, roomMute]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((time) => time > Date.now());

  return candidates.length > 0 ? new Date(Math.max(...candidates)).toISOString() : null;
};

/**
 * Everything that has to be true before a user may put a message in a room.
 * Throws the specific reason so the client can show something actionable.
 */
const assertCanPost = (user, roomId) => {
  const room = rooms.findById(roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');

  const fresh = users.findById(user.id);
  if (!fresh) throw new ForbiddenError('Your account no longer exists.');
  if (fresh.isBanned) throw new ForbiddenError('You are banned from this server.');

  const membership = rooms.getMembership(roomId, user.id);
  if (!membership) throw new ForbiddenError('Join the room before posting in it.');
  if (membership.banned_at) throw new ForbiddenError('You are banned from this room.');
  if (room.archivedAt) throw new ForbiddenError('This room is archived.');

  const mutedUntil = mutedUntilFor(user, roomId);
  if (mutedUntil) {
    const seconds = Math.ceil((new Date(mutedUntil).getTime() - Date.now()) / 1000);
    throw new ForbiddenError(`You are muted for another ${seconds} second(s).`);
  }

  return room;
};

/** Read access: public rooms are readable by members; private needs membership. */
const assertCanView = (user, roomId) => {
  const room = rooms.findById(roomId);
  if (!room) throw new NotFoundError('That room no longer exists.');

  if (isAdmin(user) && room.kind !== 'dm') return room;

  const membership = rooms.getMembership(roomId, user.id);
  if (!membership) throw new ForbiddenError('You are not a member of that room.');
  if (membership.banned_at) throw new ForbiddenError('You are banned from this room.');
  return room;
};

const canEditMessage = (user, message) =>
  Boolean(message) && !message.isDeleted && message.kind === 'user' && message.author?.id === user.id;

const canDeleteMessage = (user, message) => {
  if (!message || message.isDeleted) return false;
  if (message.author?.id === user.id) return true;
  return isRoomModerator(user, message.roomId);
};

const assertRoomModerator = (user, roomId) => {
  if (!isRoomModerator(user, roomId)) {
    throw new ForbiddenError('Only room moderators can do that.');
  }
};

const assertRoomOwner = (user, roomId) => {
  if (!isRoomOwner(user, roomId)) {
    throw new ForbiddenError('Only the room owner can do that.');
  }
};

const assertAdmin = (user) => {
  if (!isAdmin(user)) throw new ForbiddenError('Only a server admin can do that.');
};

/**
 * A moderator may not act on someone at or above their own level: room
 * moderators cannot touch owners or admins, and nobody can moderate themselves.
 */
const assertCanModerateUser = (actor, target, roomId) => {
  if (actor.id === target.id) throw new ForbiddenError('You cannot moderate yourself.');
  if (isAdmin(target) && !isAdmin(actor)) {
    throw new ForbiddenError('You cannot moderate a server admin.');
  }
  if (!isAdmin(actor) && roomId) {
    const targetRole = roomRoleOf(target, roomId);
    const actorRole = roomRoleOf(actor, roomId);
    if (targetRole === 'owner' && actorRole !== 'owner') {
      throw new ForbiddenError('You cannot moderate the room owner.');
    }
  }
};

module.exports = {
  isAdmin,
  roomRoleOf,
  isRoomModerator,
  isRoomOwner,
  mutedUntilFor,
  assertCanPost,
  assertCanView,
  canEditMessage,
  canDeleteMessage,
  assertRoomModerator,
  assertRoomOwner,
  assertAdmin,
  assertCanModerateUser,
};
