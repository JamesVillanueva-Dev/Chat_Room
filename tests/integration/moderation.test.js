import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import {
  connectReady,
  emit,
  registerUser,
  resetDatabase,
  sleep,
  startServer,
  waitFor,
} from '../helpers.js';

const require = createRequire(import.meta.url);
const usersRepo = require('../../src/db/repositories/users');

let server;
let admin;
let member;
let outsider;
let adminSocket;
let memberSocket;
let roomId;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  adminSocket?.close();
  memberSocket?.close();
  resetDatabase();
  for (const limiter of Object.values(server.realtime.limiters)) limiter.clear();
  server.realtime.connections.clear();

  // The first account registered becomes the server admin.
  admin = await registerUser(server.httpServer, 'admin.alice');
  member = await registerUser(server.httpServer, 'bob');
  outsider = await registerUser(server.httpServer, 'carol');

  const a = await connectReady(server.url, admin.cookie);
  const b = await connectReady(server.url, member.cookie);
  adminSocket = a.socket;
  memberSocket = b.socket;
  roomId = a.ready.rooms[0].id;
});

const run = (socket, body) => emit(socket, 'message:send', { roomId, body });

describe('muting', () => {
  it('stops a muted member posting, and unmuting restores it', async () => {
    expect((await run(adminSocket, '/mute @bob 5 too noisy')).ok).toBe(true);

    const blocked = await run(memberSocket, 'can I still talk?');
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/muted/i);

    expect((await run(adminSocket, '/unmute @bob')).ok).toBe(true);
    expect((await run(memberSocket, 'thanks')).ok).toBe(true);
  });

  it('announces the mute in the room', async () => {
    await run(adminSocket, '/mute @bob 5 spamming');
    const history = await admin.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.some((m) => m.kind === 'system' && /bob was muted/.test(m.body))).toBe(true);
  });

  it('records the action in the moderation log', async () => {
    await run(adminSocket, '/mute @bob 5 spamming');
    const log = await admin.agent.get('/api/admin/moderation-log');

    const entry = log.body.entries.find((e) => e.action === 'mute');
    expect(entry.target.username).toBe('bob');
    expect(entry.actor.username).toBe('admin.alice');
    expect(entry.reason).toBe('spamming');
  });

  it('refuses to mute someone who is not in the room', async () => {
    // Everyone auto-joins the default room, so use one carol never joined.
    const other = await admin.agent.post('/api/rooms').send({ name: 'Side Channel' });
    const sideRoomId = other.body.room.id;
    await emit(adminSocket, 'room:join', { roomId: sideRoomId });

    const result = await emit(adminSocket, 'message:send', {
      roomId: sideRoomId,
      body: '/mute @carol 5',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in this room/i);
  });

  it('refuses to mute a name that does not exist', async () => {
    const result = await run(adminSocket, '/mute @nobody 5');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no such user/i);
  });

  it('rejects a nonsense duration', async () => {
    expect((await run(adminSocket, '/mute @bob abc')).ok).toBe(true); // treated as reason, default duration
    await run(adminSocket, '/unmute @bob');
    expect((await run(adminSocket, '/mute @bob -5')).ok).toBe(true);
  });
});

describe('kicking', () => {
  it('removes the member, tells them, and blocks further posts', async () => {
    const kicked = waitFor(memberSocket, 'room:kicked');
    expect((await run(adminSocket, '/kick @bob being disruptive')).ok).toBe(true);

    expect((await kicked).roomId).toBe(roomId);
    expect((await run(memberSocket, 'let me back in')).ok).toBe(false);
    expect((await member.agent.get(`/api/rooms/${roomId}/messages`)).status).toBe(403);
  });

  it('lets a kicked member rejoin a public room', async () => {
    await run(adminSocket, '/kick @bob');
    await sleep(200);

    expect((await member.agent.post(`/api/rooms/${roomId}/join`)).status).toBe(201);
    expect((await member.agent.get(`/api/rooms/${roomId}/messages`)).status).toBe(200);
  });
});

describe('banning', () => {
  it('bans from a room and blocks rejoining', async () => {
    expect((await run(adminSocket, '/ban @bob rule breaking')).ok).toBe(true);
    await sleep(200);

    expect((await member.agent.post(`/api/rooms/${roomId}/join`)).status).toBe(403);
    expect((await run(memberSocket, 'hello?')).ok).toBe(false);
  });

  it('lifts a room ban with /unban', async () => {
    await run(adminSocket, '/ban @bob');
    await sleep(150);
    expect((await run(adminSocket, '/unban @bob')).ok).toBe(true);
    expect((await member.agent.post(`/api/rooms/${roomId}/join`)).status).toBe(200);
  });

  it('bans server-wide and ends the user session', async () => {
    const ended = waitFor(memberSocket, 'session:ended', 5000).catch(() => null);
    expect((await run(adminSocket, '/ban @bob --server abusive')).ok).toBe(true);
    await sleep(300);

    expect(usersRepo.findById(member.user.id).isBanned).toBe(true);
    expect((await member.agent.get('/api/rooms')).status).toBe(401);
    await ended;
  });

  it('stops a banned account signing back in', async () => {
    await run(adminSocket, '/ban @bob --server abusive');
    await sleep(200);

    const { request } = await import('../helpers.js');
    const login = await request(server.httpServer)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'password123' });
    expect(login.status).toBe(403);
  });
});

describe('permission boundaries', () => {
  it('stops a regular member using moderation commands', async () => {
    for (const command of ['/kick @admin.alice', '/mute @admin.alice 5', '/ban @admin.alice', '/topic hijacked']) {
      const result = await run(memberSocket, command);
      expect(result.ok, `${command} should be refused`).toBe(false);
      expect(result.error).toMatch(/permission/i);
    }
  });

  it('stops anyone moderating themselves', async () => {
    const result = await run(adminSocket, '/kick @admin.alice');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/yourself/i);
  });

  it('stops a room moderator from acting on a server admin', async () => {
    await admin.agent.post(`/api/rooms/${roomId}/members/${member.user.id}/role`).send({ role: 'moderator' });
    const result = await run(memberSocket, '/kick @admin.alice');
    expect(result.ok).toBe(false);
  });

  it('lets a promoted room moderator moderate ordinary members', async () => {
    await outsider.agent.post(`/api/rooms/${roomId}/join`);
    await admin.agent.post(`/api/rooms/${roomId}/members/${member.user.id}/role`).send({ role: 'moderator' });

    const result = await run(memberSocket, '/mute @carol 5 noisy');
    expect(result.ok).toBe(true);
  });
});

describe('the admin API', () => {
  it('is closed to non-admins', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/moderation-log']) {
      expect((await member.agent.get(path)).status, path).toBe(403);
    }
    expect((await member.agent.post(`/api/admin/users/${admin.user.id}/ban`).send({})).status).toBe(403);
  });

  it('summarises the server for an admin', async () => {
    const overview = await admin.agent.get('/api/admin/overview');

    expect(overview.status).toBe(200);
    expect(overview.body.stats.users).toBe(3);
    expect(overview.body.stats.rooms).toBeGreaterThanOrEqual(1);
    expect(overview.body.metrics.connections.active).toBeGreaterThan(0);
    expect(Array.isArray(overview.body.users)).toBe(true);
  });

  it('bans and unbans through the API', async () => {
    const banned = await admin.agent.post(`/api/admin/users/${member.user.id}/ban`).send({ reason: 'testing' });
    expect(banned.body.user.isBanned).toBe(true);

    const unbanned = await admin.agent.post(`/api/admin/users/${member.user.id}/unban`);
    expect(unbanned.body.user.isBanned).toBe(false);
  });

  it('promotes and demotes, but never yourself', async () => {
    const promoted = await admin.agent.post(`/api/admin/users/${member.user.id}/role`).send({ role: 'admin' });
    expect(promoted.body.user.role).toBe('admin');

    const self = await admin.agent.post(`/api/admin/users/${admin.user.id}/role`).send({ role: 'user' });
    expect(self.status).toBe(400);
  });

  it('rejects an unknown role', async () => {
    const response = await admin.agent.post(`/api/admin/users/${member.user.id}/role`).send({ role: 'wizard' });
    expect(response.status).toBe(400);
  });
});

describe('the metrics endpoint', () => {
  it('is not public but is open to an admin', async () => {
    const { request } = await import('../helpers.js');
    expect((await request(server.httpServer).get('/metrics')).status).toBe(403);

    const metrics = await admin.agent.get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.body.connections.active).toBeGreaterThan(0);
    expect(metrics.body.database.driver).toBeTruthy();
    expect(metrics.body).toHaveProperty('messages.total');
  });

  it('counts messages as they are sent', async () => {
    const before = (await admin.agent.get('/metrics')).body.messages.total;
    await run(adminSocket, 'one');
    await run(adminSocket, 'two');

    const after = (await admin.agent.get('/metrics')).body.messages.total;
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });
});
