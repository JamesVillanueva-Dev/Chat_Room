import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { registerUser, request, resetDatabase } from '../helpers.js';

const require = createRequire(import.meta.url);
const { createApp } = require('../../src/http/app');

const app = createApp();
let alice;
let bob;
let generalId;

beforeEach(async () => {
  resetDatabase();
  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
  generalId = (await alice.agent.get('/api/rooms')).body.rooms[0].id;
});

describe('creating and listing rooms', () => {
  it('creates a room with a slug and makes the creator its owner', async () => {
    const response = await alice.agent.post('/api/rooms').send({ name: 'Project X!', topic: 'planning' });

    expect(response.status).toBe(201);
    expect(response.body.room.slug).toBe('project-x');
    expect(response.body.room.roomRole).toBe('owner');
    expect(response.body.room.topic).toBe('planning');
  });

  it('gives colliding names distinct slugs', async () => {
    const first = await alice.agent.post('/api/rooms').send({ name: 'Team' });
    const second = await alice.agent.post('/api/rooms').send({ name: 'Team' });

    expect(first.body.room.slug).toBe('team');
    expect(second.body.room.slug).toBe('team-2');
  });

  it('lists only the rooms the caller belongs to', async () => {
    await alice.agent.post('/api/rooms').send({ name: 'Alice Only' });

    const forAlice = await alice.agent.get('/api/rooms');
    const forBob = await bob.agent.get('/api/rooms');

    expect(forAlice.body.rooms.map((r) => r.name)).toContain('Alice Only');
    expect(forBob.body.rooms.map((r) => r.name)).not.toContain('Alice Only');
  });

  it('rejects a nonsense room name', async () => {
    expect((await alice.agent.post('/api/rooms').send({ name: 'x' })).status).toBe(400);
    expect((await alice.agent.post('/api/rooms').send({ name: '!!!' })).status).toBe(400);
  });
});

describe('joining rooms', () => {
  it('lets anyone join a public room and announces it', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Open House' });
    const joined = await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    expect(joined.status).toBe(201);

    const history = await bob.agent.get(`/api/rooms/${body.room.id}/messages`);
    const system = history.body.messages.filter((m) => m.kind === 'system');
    expect(system.some((m) => m.body.includes('bob joined'))).toBe(true);
  });

  it('is idempotent when already a member', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Open House' });
    await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    const again = await bob.agent.post(`/api/rooms/${body.room.id}/join`);
    expect(again.status).toBe(200);
    expect(again.body.alreadyMember).toBe(true);
  });

  it('keeps a private room invite-only', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Inner Circle', visibility: 'private' });

    expect((await bob.agent.post(`/api/rooms/${body.room.id}/join`)).status).toBe(403);
    expect((await bob.agent.get(`/api/rooms/${body.room.id}/messages`)).status).toBe(403);

    const browse = await bob.agent.get('/api/rooms/public');
    expect(browse.body.rooms.some((r) => r.id === body.room.id)).toBe(false);
  });

  it('requires the right password when one is set', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Locked', password: 'hunter2' });
    expect(body.room.hasPassword).toBe(true);

    expect((await bob.agent.post(`/api/rooms/${body.room.id}/join`).send({ password: 'wrong' })).status).toBe(403);
    expect((await bob.agent.post(`/api/rooms/${body.room.id}/join`).send({})).status).toBe(403);
    expect((await bob.agent.post(`/api/rooms/${body.room.id}/join`).send({ password: 'hunter2' })).status).toBe(201);
  });

  it('leaves a room but protects the default room', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Temporary' });
    await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    expect((await bob.agent.post(`/api/rooms/${body.room.id}/leave`)).status).toBe(204);
    expect((await bob.agent.get(`/api/rooms/${body.room.id}/messages`)).status).toBe(403);
    expect((await bob.agent.post(`/api/rooms/${generalId}/leave`)).status).toBe(403);
  });
});

describe('invite links', () => {
  it('lets an invited user into a private room, once', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Inner Circle', visibility: 'private' });
    const roomId = body.room.id;

    const invite = await alice.agent.post(`/api/rooms/${roomId}/invites`).send({ maxUses: 1 });
    expect(invite.status).toBe(201);
    const { code } = invite.body.invite;

    const preview = await bob.agent.get(`/api/invites/${code}`);
    expect(preview.body.room.name).toBe('Inner Circle');
    expect(preview.body.alreadyMember).toBe(false);

    expect((await bob.agent.post(`/api/invites/${code}/accept`)).status).toBe(201);
    expect((await bob.agent.get(`/api/rooms/${roomId}/messages`)).status).toBe(200);

    const carol = await registerUser(app, 'carol');
    expect((await carol.agent.post(`/api/invites/${code}/accept`)).status).toBe(403);
  });

  it('rejects an unknown or revoked code', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Club' });
    const invite = await alice.agent.post(`/api/rooms/${body.room.id}/invites`).send({});
    const { code } = invite.body.invite;

    expect((await bob.agent.get('/api/invites/does-not-exist')).status).toBe(404);

    await alice.agent.delete(`/api/rooms/${body.room.id}/invites/${code}`);
    expect((await bob.agent.post(`/api/invites/${code}/accept`)).status).toBe(403);
  });

  it('only lets moderators mint invites', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Club' });
    await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    expect((await bob.agent.post(`/api/rooms/${body.room.id}/invites`).send({})).status).toBe(403);
  });
});

describe('room settings', () => {
  it('lets the owner rename and re-topic the room', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Old Name' });
    const updated = await alice.agent.patch(`/api/rooms/${body.room.id}`).send({ name: 'New Name', topic: 'fresh' });

    expect(updated.body.room.name).toBe('New Name');
    expect(updated.body.room.topic).toBe('fresh');
  });

  it('stops a plain member changing settings or deleting', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Club' });
    await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    expect((await bob.agent.patch(`/api/rooms/${body.room.id}`).send({ name: 'Hijacked' })).status).toBe(403);
    expect((await bob.agent.delete(`/api/rooms/${body.room.id}`)).status).toBe(403);
  });

  it('deletes a room and its messages, but never the default room', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Doomed' });
    expect((await alice.agent.delete(`/api/rooms/${body.room.id}`)).status).toBe(204);
    expect((await alice.agent.get(`/api/rooms/${body.room.id}`)).status).toBe(404);

    expect((await alice.agent.delete(`/api/rooms/${generalId}`)).status).toBe(403);
  });

  it('promotes a member to moderator', async () => {
    const { body } = await alice.agent.post('/api/rooms').send({ name: 'Club' });
    await bob.agent.post(`/api/rooms/${body.room.id}/join`);

    const promoted = await alice.agent
      .post(`/api/rooms/${body.room.id}/members/${bob.user.id}/role`)
      .send({ role: 'moderator' });
    expect(promoted.status).toBe(200);

    const detail = await bob.agent.get(`/api/rooms/${body.room.id}`);
    expect(detail.body.canModerate).toBe(true);
  });
});

describe('direct messages', () => {
  it('creates one conversation per pair, whoever opens it', async () => {
    const first = await alice.agent.post('/api/dms').send({ userId: bob.user.id });
    expect(first.status).toBe(201);

    const again = await bob.agent.post('/api/dms').send({ userId: alice.user.id });
    expect(again.status).toBe(200);
    expect(again.body.room.id).toBe(first.body.room.id);
  });

  it('shows the other person as the conversation partner', async () => {
    await alice.agent.post('/api/dms').send({ userId: bob.user.id });

    const forBob = (await bob.agent.get('/api/rooms')).body.rooms.find((r) => r.kind === 'dm');
    expect(forBob.partner.username).toBe('alice');
  });

  it('keeps outsiders out', async () => {
    const { body } = await alice.agent.post('/api/dms').send({ userId: bob.user.id });
    const carol = await registerUser(app, 'carol');

    expect((await carol.agent.get(`/api/rooms/${body.room.id}/messages`)).status).toBe(403);
  });

  it('refuses a conversation with yourself or a stranger id', async () => {
    expect((await alice.agent.post('/api/dms').send({ userId: alice.user.id })).status).toBe(400);
    expect((await alice.agent.post('/api/dms').send({ userId: 9999 })).status).toBe(404);
  });

  it('never lists direct messages in the public browser', async () => {
    await alice.agent.post('/api/dms').send({ userId: bob.user.id });
    const browse = await alice.agent.get('/api/rooms/public');
    expect(browse.body.rooms.every((room) => room.kind !== 'dm')).toBe(true);
  });
});
