'use strict';

const { Server } = require('socket.io');

const config = require('../config');
const messagesRepo = require('../db/repositories/messages');
const rooms = require('../db/repositories/rooms');
const users = require('../db/repositories/users');
const chat = require('../services/chat');
const logger = require('../logger').child({ component: 'realtime' });
const metrics = require('../services/metrics');
const permissions = require('../services/permissions');
const validate = require('../lib/validate');
const commandRegistry = require('./commands');
const { CommandRegistry } = require('./commands/registry');
const { ConnectionCounter, RateLimiter } = require('./rateLimiter');
const { PresenceTracker } = require('./presence');
const { sessionMiddleware } = require('../auth/session');
const { bus, EVENTS } = require('../services/events');
const { AppError, RateLimitError } = require('../lib/errors');

const roomChannel = (roomId) => `room:${roomId}`;
const userChannel = (userId) => `user:${userId}`;

const attachRealtime = (httpServer) => {
  const io = new Server(httpServer, {
    // Long enough to ride out a laptop sleeping or a tunnel blip; the client
    // replays anything it queued while disconnected.
    pingTimeout: 25000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  });

  const presence = new PresenceTracker();
  const connections = new ConnectionCounter(config.limits.connectionsPerIp);
  const messageLimiter = new RateLimiter();
  // Commands can be expensive (the RPS bot spawns a process), so they get their
  // own budget rather than sharing the message allowance.
  const commandLimiter = new RateLimiter({ max: 12 });
  const typingLimiter = new RateLimiter({ windowMs: 5000, max: 12, backoffMs: 1000 });

  const sweepTimer = setInterval(() => {
    messageLimiter.sweep();
    commandLimiter.sweep();
    typingLimiter.sweep();
  }, 5 * 60 * 1000);
  sweepTimer.unref?.();

  // The session cookie is parsed on the handshake, so the websocket and the
  // HTTP API agree on who the user is without a second token scheme.
  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const userId = socket.request?.session?.userId;
    if (!userId) return next(new Error('unauthorized'));

    const user = users.findById(userId);
    if (!user) return next(new Error('unauthorized'));
    if (user.isBanned) return next(new Error('banned'));

    const address = socket.handshake.address || 'unknown';
    if (!connections.tryAdd(address)) {
      logger.warn('connection cap reached', { address, cap: config.limits.connectionsPerIp });
      return next(new Error('too many connections'));
    }

    socket.data.user = user;
    socket.data.address = address;
    return next();
  });

  const currentUser = (socket) => users.findById(socket.data.user.id) || socket.data.user;

  const notice = (socket, text, level = 'info') => socket.emit('notice', { level, text });

  /**
   * Wraps a handler so every client event answers its callback exactly once,
   * turning expected errors into a message and unexpected ones into a log line.
   */
  const handle = (socket, name, handler) =>
    async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      try {
        const result = (await handler(payload || {})) || {};
        respond({ ok: true, ...result });
      } catch (error) {
        const expected = error instanceof AppError && error.expected;
        if (!expected) {
          metrics.increment('socketErrors');
          logger.error('socket handler failed', { event: name, userId: socket.data.user.id, error });
        }
        const message = expected ? error.message : 'Something went wrong.';
        respond({ ok: false, error: message, code: error.code || null });
        if (typeof ack !== 'function') notice(socket, message, 'error');
      }
    };

  const enforce = (limiter, key, what) => {
    const outcome = limiter.consume(key);
    if (outcome.allowed) return;
    metrics.increment('rateLimitHits');
    throw new RateLimitError(
      `You are sending ${what} too quickly. Wait ${Math.ceil(outcome.retryAfterMs / 1000)}s.`,
      outcome.retryAfterMs
    );
  };

  /** Subscribes a socket to every room the user belongs to. */
  const joinMembershipChannels = (socket) => {
    socket.join(userChannel(socket.data.user.id));
    for (const room of rooms.listForUser(socket.data.user.id)) {
      socket.join(roomChannel(room.id));
    }
  };

  const runCommand = async (socket, { roomId, parsed }) => {
    const user = currentUser(socket);
    enforce(commandLimiter, user.id, 'commands');
    metrics.increment('commandsRun');

    const origin = socket.handshake.headers.origin || '';

    return commandRegistry.run(parsed.name, {
      user,
      roomId,
      args: parsed.args,
      argv: parsed.argv,
      origin,
      reply: (text) => {
        notice(socket, text);
        return { handled: true, ephemeral: true };
      },
      say: (text, label = 'Bot') => {
        chat.postBotMessage({ roomId, body: text, label });
        return { handled: true };
      },
      system: (text) => {
        chat.postSystemMessage(roomId, text);
        return { handled: true };
      },
      postAsUser: (text) => {
        const message = chat.postUserMessage({ user, roomId, body: text });
        return { handled: true, message };
      },
    });
  };

  io.on('connection', (socket) => {
    const user = socket.data.user;
    metrics.connectionOpened();
    logger.info('socket connected', { socketId: socket.id, userId: user.id, username: user.username });

    joinMembershipChannels(socket);

    const updated = presence.connect(user.id, socket.id);
    if (updated) io.emit('presence:update', { user: updated });

    socket.emit('ready', {
      user: currentUser(socket),
      rooms: rooms.listForUser(user.id),
      commands: commandRegistry.list({ user: currentUser(socket) }).map((command) => ({
        name: command.name,
        usage: command.usage,
        summary: command.summary,
      })),
    });

    socket.on(
      'message:send',
      handle(socket, 'message:send', async ({ roomId, body, parentId, attachmentId, clientId }) => {
        const targetRoom = validate.positiveInt(roomId, 'roomId');
        const actor = currentUser(socket);
        let text = typeof body === 'string' ? body.trim() : '';

        // A leading `//` escapes the command parser so a message can start with
        // a literal slash.
        if (text.startsWith('//')) {
          text = text.slice(1);
        } else {
          const parsed = CommandRegistry.parse(text);
          if (parsed) {
            permissions.assertCanView(actor, targetRoom);
            // A typo must not be broadcast: `/mte @bob spamming` should fail
            // rather than post the accusation to the room.
            const outcome = await runCommand(socket, { roomId: targetRoom, parsed });
            return { clientId, command: parsed.name, ...outcome };
          }
        }

        enforce(messageLimiter, actor.id, 'messages');
        const message = chat.postUserMessage({
          user: actor,
          roomId: targetRoom,
          body: text,
          parentId: parentId ? validate.positiveInt(parentId, 'parentId') : null,
          attachmentId: attachmentId ? validate.positiveInt(attachmentId, 'attachmentId') : null,
        });

        return { clientId, message };
      })
    );

    socket.on(
      'message:edit',
      handle(socket, 'message:edit', ({ messageId, body }) => ({
        message: chat.editMessage({
          user: currentUser(socket),
          messageId: validate.positiveInt(messageId, 'messageId'),
          body,
        }),
      }))
    );

    socket.on(
      'message:delete',
      handle(socket, 'message:delete', ({ messageId }) => {
        chat.deleteMessage({
          user: currentUser(socket),
          messageId: validate.positiveInt(messageId, 'messageId'),
        });
        return {};
      })
    );

    socket.on(
      'reaction:toggle',
      handle(socket, 'reaction:toggle', ({ messageId, emoji }) =>
        chat.toggleReaction({
          user: currentUser(socket),
          messageId: validate.positiveInt(messageId, 'messageId'),
          emoji,
        })
      )
    );

    socket.on(
      'message:pin',
      handle(socket, 'message:pin', ({ messageId }) => ({
        message: chat.togglePin({
          user: currentUser(socket),
          messageId: validate.positiveInt(messageId, 'messageId'),
        }),
      }))
    );

    socket.on(
      'room:join',
      handle(socket, 'room:join', ({ roomId }) => {
        const targetRoom = validate.positiveInt(roomId, 'roomId');
        permissions.assertCanView(currentUser(socket), targetRoom);
        socket.join(roomChannel(targetRoom));
        return { roomId: targetRoom };
      })
    );

    socket.on('room:leave', ({ roomId }) => {
      const parsed = Number.parseInt(roomId, 10);
      if (Number.isFinite(parsed)) socket.leave(roomChannel(parsed));
    });

    socket.on(
      'room:read',
      handle(socket, 'room:read', ({ roomId, messageId }) => {
        const targetRoom = validate.positiveInt(roomId, 'roomId');
        permissions.assertCanView(currentUser(socket), targetRoom);
        rooms.markRead(targetRoom, socket.data.user.id, validate.positiveInt(messageId, 'messageId'));
        return { roomId: targetRoom };
      })
    );

    socket.on('typing', ({ roomId, isTyping }) => {
      const parsed = Number.parseInt(roomId, 10);
      if (!Number.isFinite(parsed)) return;
      // Typing noise is dropped silently rather than reported back.
      if (!typingLimiter.consume(`${socket.data.user.id}:typing`).allowed) return;
      if (!rooms.isMember(parsed, socket.data.user.id)) return;

      socket.to(roomChannel(parsed)).emit('typing', {
        roomId: parsed,
        user: { id: user.id, username: user.username, displayName: user.displayName },
        isTyping: Boolean(isTyping),
      });
    });

    socket.on(
      'presence:set',
      handle(socket, 'presence:set', ({ presence: value }) => {
        const updatedUser = users.updateProfile(socket.data.user.id, {
          presence: validate.presence(value),
        });
        io.emit('presence:update', { user: updatedUser });
        return { user: updatedUser };
      })
    );

    socket.on('disconnect', (reason) => {
      metrics.connectionClosed();
      connections.remove(socket.data.address);
      const offline = presence.disconnect(user.id, socket.id);
      if (offline) io.emit('presence:update', { user: offline });
      logger.debug('socket disconnected', { socketId: socket.id, userId: user.id, reason });
    });
  });

  // --- fan out domain events to the right sockets -----------------------

  const subscriptions = [
    [
      EVENTS.MESSAGE_CREATED,
      (message) => io.to(roomChannel(message.roomId)).emit('message:new', { message }),
    ],
    [
      EVENTS.MESSAGE_UPDATED,
      (message) => io.to(roomChannel(message.roomId)).emit('message:updated', { message }),
    ],
    [
      EVENTS.MESSAGE_DELETED,
      ({ id, roomId }) => io.to(roomChannel(roomId)).emit('message:deleted', { id, roomId }),
    ],
    [
      EVENTS.MESSAGE_REACTIONS,
      ({ messageId, roomId, reactions }) =>
        io.to(roomChannel(roomId)).emit('message:reactions', { messageId, roomId, reactions }),
    ],
    [
      EVENTS.MESSAGE_PINNED,
      ({ roomId }) =>
        io.to(roomChannel(roomId)).emit('room:pinned', { roomId, pinned: messagesRepo.listPinned(roomId) }),
    ],
    [EVENTS.ROOM_UPDATED, (room) => io.to(roomChannel(room.id)).emit('room:updated', { room })],
    [
      EVENTS.ROOM_MEMBERS_CHANGED,
      ({ roomId, joinedUserId }) => {
        io.to(roomChannel(roomId)).emit('room:members-changed', {
          roomId,
          members: rooms.listMembers(roomId),
        });
        // A new member's own sockets need to start receiving this room.
        if (joinedUserId) {
          for (const socket of io.sockets.sockets.values()) {
            if (socket.data.user?.id === joinedUserId) socket.join(roomChannel(roomId));
          }
          io.to(userChannel(joinedUserId)).emit('rooms:refresh');
        }
      },
    ],
    [
      EVENTS.ROOM_DELETED,
      ({ roomId, memberIds = [], name }) => {
        io.to(roomChannel(roomId)).emit('room:deleted', { roomId, name });
        for (const memberId of memberIds) io.to(userChannel(memberId)).emit('rooms:refresh');
        io.socketsLeave(roomChannel(roomId));
      },
    ],
    [EVENTS.USER_UPDATED, (updatedUser) => io.emit('presence:update', { user: updatedUser })],
    [
      EVENTS.MENTION,
      ({ userIds, message, room }) => {
        for (const mentionedId of userIds) {
          io.to(userChannel(mentionedId)).emit('mention', {
            message,
            room: { id: room.id, name: room.name, kind: room.kind },
          });
        }
      },
    ],
    [
      EVENTS.FORCE_DISCONNECT,
      ({ userId, roomId, scope, reason }) => {
        if (scope === 'room') {
          for (const socket of io.sockets.sockets.values()) {
            if (socket.data.user?.id === userId) socket.leave(roomChannel(roomId));
          }
          io.to(userChannel(userId)).emit('room:kicked', { roomId, reason });
          io.to(userChannel(userId)).emit('rooms:refresh');
          return;
        }

        io.to(userChannel(userId)).emit('session:ended', { reason });
        for (const socket of io.sockets.sockets.values()) {
          if (socket.data.user?.id === userId) socket.disconnect(true);
        }
      },
    ],
  ];

  for (const [event, listener] of subscriptions) bus.on(event, listener);

  const detach = () => {
    for (const [event, listener] of subscriptions) bus.off(event, listener);
    clearInterval(sweepTimer);
  };

  return {
    io,
    presence,
    detach,
    limiters: { messageLimiter, commandLimiter, typingLimiter },
    connections,
  };
};

module.exports = { attachRealtime, roomChannel, userChannel };
