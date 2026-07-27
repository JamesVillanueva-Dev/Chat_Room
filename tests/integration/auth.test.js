import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { db, request, resetDatabase } from '../helpers.js';

const require = createRequire(import.meta.url);
const { createApp } = require('../../src/http/app');
const authService = require('../../src/auth/service');
const usersRepo = require('../../src/db/repositories/users');

const app = createApp();

beforeEach(() => {
  resetDatabase();
  authService.loginThrottle.clear();
});

describe('registration', () => {
  it('creates an account and starts a session', async () => {
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    expect(response.status).toBe(201);
    expect(response.body.user.username).toBe('alice');
    expect(response.body.user).not.toHaveProperty('password_hash');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.username).toBe('alice');
  });

  it('stores the password as a bcrypt hash, never in the clear', async () => {
    await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    const row = db.get('SELECT password_hash FROM users WHERE username = ?', 'alice');
    expect(row.password_hash).not.toBe('password123');
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('makes the first account an admin and later ones regular users', async () => {
    const first = await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' });
    const second = await request(app).post('/api/auth/register').send({ username: 'bob', password: 'password123' });

    expect(first.body.user.role).toBe('admin');
    expect(second.body.user.role).toBe('user');
  });

  it('adds new accounts to the default room', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    const rooms = await agent.get('/api/rooms');
    expect(rooms.body.rooms.map((room) => room.slug)).toContain('general');
  });

  it('rejects a duplicate username regardless of case', async () => {
    await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' });
    const response = await request(app).post('/api/auth/register').send({ username: 'ALICE', password: 'password123' });

    expect(response.status).toBe(409);
    expect(response.body.field).toBe('username');
  });

  it('rejects invalid input with the offending field named', async () => {
    const short = await request(app).post('/api/auth/register').send({ username: 'ab', password: 'password123' });
    expect(short.status).toBe(400);
    expect(short.body.field).toBe('username');

    const weak = await request(app).post('/api/auth/register').send({ username: 'alice', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.field).toBe('password');

    const reserved = await request(app).post('/api/auth/register').send({ username: 'system', password: 'password123' });
    expect(reserved.status).toBe(400);
  });
});

describe('sign in', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' });
  });

  it('accepts the right password', async () => {
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/login').send({ username: 'alice', password: 'password123' });

    expect(response.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.username).toBe('alice');
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrongPassword = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'nope12345' });
    const unknownUser = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'nope12345' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });

  it('issues a new session id on sign in, defeating session fixation', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/me');

    const login = await agent.post('/api/auth/login').send({ username: 'alice', password: 'password123' });
    expect(login.headers['set-cookie']).toBeDefined();
  });

  it('throttles repeated failures from one address', async () => {
    let throttled = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrong1234' });
      if (response.status === 429) {
        throttled = response;
        break;
      }
    }

    expect(throttled, 'brute force was never throttled').not.toBeNull();
    expect(throttled.body.error).toMatch(/Too many sign-in attempts/);
    expect(throttled.headers['retry-after']).toBeDefined();
  });

  it('refuses a banned account and says why', async () => {
    const user = usersRepo.findByUsername('alice');
    usersRepo.setBanned(user.id, { banned: true, reason: 'spam' });

    const response = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'password123' });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/spam/);
  });
});

describe('session lifecycle', () => {
  it('signs out and forgets the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    expect((await agent.get('/api/rooms')).status).toBe(401);
  });

  it('persists sessions in the database so they survive a restart', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    expect(db.pluck('SELECT COUNT(*) FROM sessions')).toBeGreaterThan(0);

    // A brand new app object reads the same session table.
    const freshApp = createApp();
    const cookie = (await agent.get('/api/auth/me')).request.cookies;
    const response = await request(freshApp).get('/api/auth/me').set('Cookie', cookie);
    expect(response.body.user.username).toBe('alice');
  });

  it('drops the session as soon as the account is banned', async () => {
    const agent = request.agent(app);
    const registered = await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    usersRepo.setBanned(registered.body.user.id, { banned: true, reason: 'rules' });
    expect((await agent.get('/api/rooms')).status).toBe(401);
  });

  it('requires authentication on protected routes', async () => {
    for (const path of ['/api/rooms', '/api/users', '/api/admin/overview']) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });
});

describe('changing a password', () => {
  it('requires the current password and then accepts the new one', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username: 'alice', password: 'password123' });

    const wrong = await agent.post('/api/auth/password').send({ currentPassword: 'nope12345', newPassword: 'newpassword1' });
    expect(wrong.status).toBe(401);

    const changed = await agent.post('/api/auth/password').send({ currentPassword: 'password123', newPassword: 'newpassword1' });
    expect(changed.status).toBe(204);

    await agent.post('/api/auth/logout');
    const relogin = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'newpassword1' });
    expect(relogin.status).toBe(200);
  });
});
