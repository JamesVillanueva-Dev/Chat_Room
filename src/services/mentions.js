'use strict';

const rooms = require('../db/repositories/rooms');
const users = require('../db/repositories/users');
const permissions = require('./permissions');

// Matches @name where the @ is not part of an email address or a longer word.
const MENTION_PATTERN = /(?:^|[^\w@/])@([a-z0-9][a-z0-9._-]{1,23})/gi;
const BROADCAST_PATTERN = /(?:^|[^\w@/])@(everyone|here)\b/i;

const extractUsernames = (body) => {
  const found = new Set();
  for (const match of String(body).matchAll(MENTION_PATTERN)) {
    const name = match[1].replace(/[._-]+$/, '');
    if (name.length >= 2) found.add(name.toLowerCase());
  }
  return [...found];
};

/**
 * Resolves the @names in a message to real user ids.
 *
 * `@everyone` / `@here` expand to every member of the room, but only for room
 * moderators — otherwise any user could ping the whole room at will.
 */
const resolve = (body, { roomId, authorId, author }) => {
  const usernames = extractUsernames(body);
  const matched = usernames.length > 0 ? users.findManyByUsernames(usernames) : [];
  const ids = new Set(matched.map((user) => user.id));

  const broadcast = BROADCAST_PATTERN.test(body);
  const broadcastAllowed = broadcast && author && permissions.isRoomModerator(author, roomId);
  if (broadcastAllowed) {
    for (const memberId of rooms.listMemberIds(roomId)) ids.add(memberId);
  }

  ids.delete(authorId);

  // Only members of the room can be mentioned into it.
  const memberIds = new Set(rooms.listMemberIds(roomId));
  const userIds = [...ids].filter((id) => memberIds.has(id));

  return {
    userIds,
    usernames: matched.map((user) => user.username),
    broadcast: Boolean(broadcastAllowed),
  };
};

module.exports = { MENTION_PATTERN, extractUsernames, resolve };
