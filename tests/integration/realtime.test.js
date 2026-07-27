import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectReady,
  connectSocket,
  emit,
  registerUser,
  resetDatabase,
  sleep,
  startServer,
  waitFor,
  waitForMatch,
} from '../helpers.js';

let server;
let alice;
let bob;
let aliceSocket;
let bobSocket;
let roomId;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  aliceSocket?.close();
  bobSocket?.close();
  resetDatabase();
  for (const limiter of Object.values(server.realtime.limiters)) limiter.clear();
  server.realtime.connections.clear();

  alice = await registerUser(server.httpServer, 'alice');
  bob = await registerUser(server.httpServer, 'bob');

  const a = await connectReady(server.url, alice.cookie);
  const b = await connectReady(server.url, bob.cookie);
  aliceSocket = a.socket;
  bobSocket = b.socket;
  roomId = a.ready.rooms[0].id;
});

describe('connecting', () => {
  it('refuses a socket with no session', async () => {
    const anonymous = connectSocket(server.url, '');
    const error = await waitFor(anonymous, 'connect_error');
    expect(error.message).toMatch(/unauthorized/);
    anonymous.close();
  });

  it('sends the user, their rooms and the command list on connect', async () => {
    const { socket, ready } = await connectReady(server.url, alice.cookie);
    expect(ready.user.username).toBe('alice');
    expect(ready.rooms.length).toBeGreaterThan(0);
    expect(ready.commands.map((c) => c.name)).toContain('help');
    socket.close();
  });

  it('shares the HTTP session rather than using a separate token', async () => {
    // The cookie issued by the REST API is the only credential the socket gets.
    const { socket, ready } = await connectReady(server.url, bob.cookie);
    expect(ready.user.id).toBe(bob.user.id);
    socket.close();
  });

  it('caps concurrent connections from one address', async () => {
    const cap = server.realtime.connections.max;
    const sockets = [];

    try {
      let rejected = false;
      for (let i = 0; i < cap + 4; i += 1) {
        const socket = connectSocket(server.url, alice.cookie);
        sockets.push(socket);
        const outcome = await Promise.race([
          waitFor(socket, 'ready', 3000).then(() => 'ready'),
          waitFor(socket, 'connect_error', 3000).then((e) => e.message),
        ]).catch(() => 'timeout');

        if (typeof outcome === 'string' && /too many connections/.test(outcome)) {
          rejected = true;
          break;
        }
      }
      expect(rejected, 'connection cap never kicked in').toBe(true);
    } finally {
      for (const socket of sockets) socket.close();
    }
  });
});

describe('presence', () => {
  it('marks a user online when they connect', async () => {
    const members = await alice.agent.get(`/api/rooms/${roomId}/members`);
    const bobMember = members.body.members.find((m) => m.username === 'bob');
    expect(bobMember.presence).toBe('online');
  });

  it('broadcasts a presence change', async () => {
    // Connect-time "online" broadcasts may still be in flight, so match on the
    // presence we are actually waiting for.
    const update = waitForMatch(
      aliceSocket,
      'presence:update',
      (p) => p.user.username === 'bob' && p.user.presence === 'busy'
    );
    await emit(bobSocket, 'presence:set', { presence: 'busy' });
    expect((await update).user.presence).toBe('busy');
  });

  it('rejects an unknown presence value', async () => {
    expect((await emit(bobSocket, 'presence:set', { presence: 'napping' })).ok).toBe(false);
  });

  it('goes offline when the last socket closes', async () => {
    const { socket } = await connectReady(server.url, bob.cookie);
    bobSocket.close();
    await sleep(300);

    // A second socket is still open, so bob stays online.
    let members = await alice.agent.get(`/api/rooms/${roomId}/members`);
    expect(members.body.members.find((m) => m.username === 'bob').presence).not.toBe('offline');

    socket.close();
    await sleep(400);
    members = await alice.agent.get(`/api/rooms/${roomId}/members`);
    expect(members.body.members.find((m) => m.username === 'bob').presence).toBe('offline');
  });
});

describe('typing indicators', () => {
  it('relays typing to others in the room', async () => {
    const typing = waitFor(bobSocket, 'typing');
    aliceSocket.emit('typing', { roomId, isTyping: true });

    const payload = await typing;
    expect(payload.user.username).toBe('alice');
    expect(payload.isTyping).toBe(true);
    expect(payload.roomId).toBe(roomId);
  });

  it('does not echo your own typing back to you', async () => {
    let echoed = false;
    aliceSocket.on('typing', () => { echoed = true; });
    aliceSocket.emit('typing', { roomId, isTyping: true });
    await sleep(400);
    expect(echoed).toBe(false);
  });

  it('ignores typing for a room you are not in', async () => {
    const room = await alice.agent.post('/api/rooms').send({ name: 'Elsewhere' });
    let leaked = false;
    bobSocket.on('typing', () => { leaked = true; });

    aliceSocket.emit('typing', { roomId: room.body.room.id, isTyping: true });
    await sleep(400);
    expect(leaked).toBe(false);
  });
});

describe('slash commands over the socket', () => {
  it('runs /help and replies privately', async () => {
    const notice = waitFor(aliceSocket, 'notice');
    const ack = await emit(aliceSocket, 'message:send', { roomId, body: '/help' });

    expect(ack.ok).toBe(true);
    expect(ack.command).toBe('help');
    expect(ack.ephemeral).toBe(true);

    const text = (await notice).text;
    expect(text).toMatch(/\/play/);
    expect(text).toMatch(/\/users/);
  });

  it('hides privileged commands from users who cannot run them', async () => {
    const notice = waitFor(bobSocket, 'notice');
    await emit(bobSocket, 'message:send', { roomId, body: '/help' });
    expect((await notice).text).not.toMatch(/\/kick/);

    const denied = await emit(bobSocket, 'message:send', { roomId, body: '/kick @alice' });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/permission/i);
  });

  it('rejects an unknown command instead of broadcasting the typo', async () => {
    const mistyped = await emit(aliceSocket, 'message:send', { roomId, body: '/mte @bob spamming' });
    expect(mistyped.ok).toBe(false);
    expect(mistyped.error).toMatch(/Unknown command/);

    const history = await alice.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.some((m) => m.body.includes('spamming'))).toBe(false);
  });

  it('treats a leading double slash as literal text', async () => {
    const ack = await emit(aliceSocket, 'message:send', { roomId, body: '//not-a-command' });
    expect(ack.ok).toBe(true);
    expect(ack.message.body).toBe('/not-a-command');
  });

  it('posts /me as a bot message and /shrug as your own', async () => {
    const emote = waitForMatch(bobSocket, 'message:new', (p) => p.message.body.includes('alice waves'));
    await emit(aliceSocket, 'message:send', { roomId, body: '/me waves' });
    expect((await emote).message.kind).toBe('bot');

    const shrug = await emit(aliceSocket, 'message:send', { roomId, body: '/shrug oh well' });
    expect(shrug.message.kind).toBe('user');
    expect(shrug.message.body).toMatch(/oh well ¯/);
  });

  it('lists room members with /users', async () => {
    const notice = waitFor(aliceSocket, 'notice');
    await emit(aliceSocket, 'message:send', { roomId, body: '/users' });

    const text = (await notice).text;
    expect(text).toMatch(/alice/);
    expect(text).toMatch(/bob/);
  });

  it('sets the room topic with /topic', async () => {
    const updated = waitFor(bobSocket, 'room:updated');
    const ack = await emit(aliceSocket, 'message:send', { roomId, body: '/topic ship it by friday' });

    expect(ack.ok).toBe(true);
    expect((await updated).room.topic).toBe('ship it by friday');
  });
});

describe('the rock paper scissors bot', () => {
  it('plays a round and keeps score', async () => {
    const first = waitForMatch(bobSocket, 'message:new', (p) => p.message.authorLabel === 'RPS Bot', 20000);
    const ack = await emit(aliceSocket, 'message:send', { roomId, body: '/play rock' });
    expect(ack.ok).toBe(true);

    const message = (await first).message;
    expect(message.kind).toBe('bot');
    expect(message.body).toMatch(/alice played rock/);
    expect(message.body).toMatch(/Score after 1 round/);

    const second = waitForMatch(bobSocket, 'message:new', (p) => /Score after 2 round/.test(p.message.body), 20000);
    await emit(aliceSocket, 'message:send', { roomId, body: '/play paper' });
    expect((await second).message.body).toMatch(/Score after 2 round/);
  });

  it('explains an invalid move instead of failing', async () => {
    const notice = waitFor(aliceSocket, 'notice', 20000);
    const ack = await emit(aliceSocket, 'message:send', { roomId, body: '/play banana' });

    expect(ack.ok).toBe(true);
    expect((await notice).text).toMatch(/did not catch that move/);
  });

  it('resets the score with /play reset', async () => {
    await emit(aliceSocket, 'message:send', { roomId, body: '/play rock' });
    const notice = waitFor(aliceSocket, 'notice', 20000);
    await emit(aliceSocket, 'message:send', { roomId, body: '/play reset' });
    expect((await notice).text).toMatch(/back to 0/);
  });

  it('is not broken by the message rate limiter', async () => {
    // Commands have their own budget, and the bot's reply is server-generated
    // so it never spends the player's message allowance.
    server.realtime.limiters.messageLimiter.max = 1;
    server.realtime.limiters.messageLimiter.clear();

    try {
      const reply = waitForMatch(bobSocket, 'message:new', (p) => p.message.authorLabel === 'RPS Bot', 20000);
      const ack = await emit(aliceSocket, 'message:send', { roomId, body: '/play scissors' });
      expect(ack.ok).toBe(true);
      expect((await reply).message.body).toMatch(/alice played scissors/);
    } finally {
      server.realtime.limiters.messageLimiter.max = 1000;
      server.realtime.limiters.messageLimiter.clear();
    }
  });
});

describe('rate limiting over the socket', () => {
  it('blocks a flood and reports how long to wait', async () => {
    server.realtime.limiters.messageLimiter.max = 3;
    server.realtime.limiters.messageLimiter.clear();

    try {
      let blocked = null;
      for (let i = 0; i < 12; i += 1) {
        const ack = await emit(aliceSocket, 'message:send', { roomId, body: `spam ${i}` });
        if (!ack.ok) {
          blocked = ack;
          break;
        }
      }

      expect(blocked, 'the flood was never blocked').not.toBeNull();
      expect(blocked.code).toBe('rate_limited');
      expect(blocked.error).toMatch(/too quickly/);
    } finally {
      server.realtime.limiters.messageLimiter.max = 1000;
      server.realtime.limiters.messageLimiter.clear();
    }
  });

  it('drops excess typing events silently rather than erroring', async () => {
    for (let i = 0; i < 40; i += 1) aliceSocket.emit('typing', { roomId, isTyping: true });
    await sleep(300);
    // The socket is still healthy afterwards.
    expect((await emit(aliceSocket, 'message:send', { roomId, body: 'still here' })).ok).toBe(true);
  });
});

describe('reconnection', () => {
  it('picks the conversation back up after a drop', async () => {
    await emit(aliceSocket, 'message:send', { roomId, body: 'before the drop' });

    bobSocket.close();
    await sleep(200);
    await emit(aliceSocket, 'message:send', { roomId, body: 'while bob was away' });

    const { socket, ready } = await connectReady(server.url, bob.cookie);
    bobSocket = socket;

    // History fetched on reconnect contains what was missed.
    const history = await bob.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.some((m) => m.body === 'while bob was away')).toBe(true);
    expect(ready.rooms.find((r) => r.id === roomId).unreadCount).toBeGreaterThan(0);

    // And live delivery works again.
    const incoming = waitForMatch(bobSocket, 'message:new', (p) => p.message.body === 'after reconnect');
    await emit(aliceSocket, 'message:send', { roomId, body: 'after reconnect' });
    expect((await incoming).message.body).toBe('after reconnect');
  });

  it('keeps a second tab working when one closes', async () => {
    const second = await connectReady(server.url, alice.cookie);
    aliceSocket.close();
    await sleep(200);

    const ack = await emit(second.socket, 'message:send', { roomId, body: 'from the other tab' });
    expect(ack.ok).toBe(true);
    second.socket.close();
  });
});
