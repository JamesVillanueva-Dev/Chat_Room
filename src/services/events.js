'use strict';

const { EventEmitter } = require('events');

/**
 * Decouples "something changed" from "tell the connected clients".
 *
 * HTTP routes and socket handlers both write through the chat service, which
 * announces the result here; the realtime layer is the only subscriber that
 * turns those announcements into socket emissions. Without this the HTTP layer
 * would have to import socket.io and the socket layer would have to import the
 * routes.
 */
const bus = new EventEmitter();

// Many clients can be in one room; the default limit of 10 is unrelated to
// listener count here, but keep headroom for the realtime subscriptions.
bus.setMaxListeners(50);

const EVENTS = Object.freeze({
  MESSAGE_CREATED: 'message:created',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_REACTIONS: 'message:reactions',
  MESSAGE_PINNED: 'message:pinned',
  ROOM_UPDATED: 'room:updated',
  ROOM_MEMBERS_CHANGED: 'room:members-changed',
  ROOM_DELETED: 'room:deleted',
  USER_UPDATED: 'user:updated',
  MENTION: 'mention',
  MODERATION: 'moderation',
  FORCE_DISCONNECT: 'force-disconnect',
});

module.exports = { bus, EVENTS };
