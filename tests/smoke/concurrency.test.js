import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import {
  connectReady,
  emit,
  registerUser,
  resetDatabase,
  sleep,
  startServer,
} from '../helpers.js';

const require = createRequire(import.meta.url);
const messagesRepo = require('../../src/db/repositories/messages');

/**
 * A load-shaped sanity check rather than a benchmark: open many sockets against
 * one room, talk over each other, and confirm nothing is lost, duplicated or
 * left broken afterwards.
 */
const CLIENT_COUNT = 25;
const MESSAGES_EACH = 4;

let server;

beforeAll(async () => {
  server = await startServer();
  // The point of this file is concurrency, not throttling.
  server.realtime.connections.max = 500;
  for (const limiter of Object.values(server.realtime.limiters)) {
    limiter.max = 100000;
    limiter.clear();
  }
});

afterAll(async () => {
  await server?.close();
});

describe('many clients in one room', () => {
  it('handles concurrent connections and delivers every message', async () => {
    resetDatabase();

    const accounts = [];
    for (let i = 0; i < CLIENT_COUNT; i += 1) {
      accounts.push(await registerUser(server.httpServer, `load${i}`));
    }

    // Connect everyone at once, the way a server restart would.
    const connections = await Promise.all(
      accounts.map((account) => connectReady(server.url, account.cookie))
    );
    const sockets = connections.map((c) => c.socket);
    const roomId = connections[0].ready.rooms[0].id;

    try {
      expect(sockets.every((socket) => socket.connected)).toBe(true);
      expect(server.realtime.presence.onlineUserIds()).toHaveLength(CLIENT_COUNT);

      // One observer counts what actually arrives over the wire.
      const received = new Set();
      sockets[0].on('message:new', ({ message }) => received.add(message.body));

      const expected = new Set();
      const sends = [];
      for (let clientIndex = 0; clientIndex < sockets.length; clientIndex += 1) {
        for (let n = 0; n < MESSAGES_EACH; n += 1) {
          const body = `from-${clientIndex}-msg-${n}`;
          expected.add(body);
          sends.push(emit(sockets[clientIndex], 'message:send', { roomId, body }));
        }
      }

      const acks = await Promise.all(sends);
      const failed = acks.filter((ack) => !ack.ok);
      expect(failed, `some sends failed: ${JSON.stringify(failed.slice(0, 3))}`).toHaveLength(0);

      const total = CLIENT_COUNT * MESSAGES_EACH;
      expect(acks).toHaveLength(total);

      // Every message got a distinct id and landed in the database.
      const ids = new Set(acks.map((ack) => ack.message.id));
      expect(ids.size).toBe(total);

      const stored = messagesRepo.listForRoom(roomId, { limit: 100 });
      expect(stored.messages.length).toBeGreaterThan(0);

      // Give the fan-out a moment, then confirm the observer saw them all.
      await sleep(1500);
      const missing = [...expected].filter((body) => !received.has(body));
      expect(missing, `messages never delivered: ${missing.slice(0, 5).join(', ')}`).toHaveLength(0);

      // No duplicates were delivered.
      expect(received.size).toBe(expected.size);

      // The room's history holds exactly what was sent (plus system joins).
      const history = await accounts[0].agent.get(`/api/rooms/${roomId}/messages?limit=100`);
      const userMessages = history.body.messages.filter((m) => m.kind === 'user');
      expect(userMessages.length).toBe(total);
    } finally {
      for (const socket of sockets) socket.close();
    }

    await sleep(500);
  });

  it('cleans up presence and connection slots when everyone leaves', async () => {
    expect(server.realtime.presence.onlineUserIds()).toHaveLength(0);
    expect(server.realtime.connections.get('::ffff:127.0.0.1')).toBe(0);
  });

  it('stays responsive after the burst', async () => {
    resetDatabase();
    const account = await registerUser(server.httpServer, 'afterburst');
    const { socket, ready } = await connectReady(server.url, account.cookie);

    try {
      const ack = await emit(socket, 'message:send', {
        roomId: ready.rooms[0].id,
        body: 'still working',
      });
      expect(ack.ok).toBe(true);

      const health = await account.agent.get('/healthz');
      expect(health.body.status).toBe('ok');
    } finally {
      socket.close();
    }
  });
});
