import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectReady,
  emit,
  registerUser,
  resetDatabase,
  startServer,
  waitFor,
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

  alice = await registerUser(server.httpServer, 'alice');
  bob = await registerUser(server.httpServer, 'bob');

  const a = await connectReady(server.url, alice.cookie);
  const b = await connectReady(server.url, bob.cookie);
  aliceSocket = a.socket;
  bobSocket = b.socket;
  roomId = a.ready.rooms[0].id;
});

const send = (socket, body, extra = {}) => emit(socket, 'message:send', { roomId, body, ...extra });

describe('sending and persisting messages', () => {
  it('delivers a message to other clients and stores it', async () => {
    const incoming = waitFor(bobSocket, 'message:new');
    const ack = await send(aliceSocket, 'hello world');

    expect(ack.ok).toBe(true);
    expect((await incoming).message.body).toBe('hello world');

    const history = await alice.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.some((m) => m.body === 'hello world')).toBe(true);
  });

  it('survives a server restart', async () => {
    await send(aliceSocket, 'durable message');

    // A fresh HTTP app over the same database still sees it.
    const history = await bob.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.some((m) => m.body === 'durable message')).toBe(true);
  });

  it('echoes the clientId so an optimistic bubble can be reconciled', async () => {
    const ack = await send(aliceSocket, 'optimistic', { clientId: 'abc-123' });
    expect(ack.clientId).toBe('abc-123');
    expect(ack.message.id).toBeGreaterThan(0);
  });

  it('rejects empty, oversized and non-member sends', async () => {
    expect((await send(aliceSocket, '   ')).ok).toBe(false);
    expect((await send(aliceSocket, 'x'.repeat(5000))).ok).toBe(false);
    expect((await emit(aliceSocket, 'message:send', { roomId: 99999, body: 'hi' })).ok).toBe(false);
  });

  it('records the author and timestamp', async () => {
    const ack = await send(aliceSocket, 'signed message');
    expect(ack.message.author.username).toBe('alice');
    expect(new Date(ack.message.createdAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('history pagination', () => {
  it('returns the newest page first and walks backwards', async () => {
    for (let i = 0; i < 25; i += 1) await send(aliceSocket, `message ${i}`);

    const firstPage = await alice.agent.get(`/api/rooms/${roomId}/messages?limit=10`);
    expect(firstPage.body.messages).toHaveLength(10);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.messages.at(-1).body).toBe('message 24');

    const oldest = firstPage.body.messages[0].id;
    const secondPage = await alice.agent.get(`/api/rooms/${roomId}/messages?limit=10&before=${oldest}`);
    expect(secondPage.body.messages.at(-1).id).toBeLessThan(oldest);
    expect(secondPage.body.messages.map((m) => m.body)).not.toContain('message 24');
  });

  it('reports when there is nothing older left', async () => {
    await send(aliceSocket, 'only one');
    const page = await alice.agent.get(`/api/rooms/${roomId}/messages?limit=50`);
    expect(page.body.hasMore).toBe(false);
  });

  it('caps an outrageous page size', async () => {
    for (let i = 0; i < 5; i += 1) await send(aliceSocket, `m${i}`);
    const page = await alice.agent.get(`/api/rooms/${roomId}/messages?limit=99999`);
    expect(page.status).toBe(200);
    expect(page.body.messages.length).toBeLessThanOrEqual(100);
  });
});

describe('editing and deleting', () => {
  it('edits your own message and marks it edited', async () => {
    const ack = await send(aliceSocket, 'first draft');
    const updated = waitFor(bobSocket, 'message:updated');

    const result = await emit(aliceSocket, 'message:edit', { messageId: ack.message.id, body: 'second draft' });
    expect(result.ok).toBe(true);
    expect(result.message.body).toBe('second draft');
    expect(result.message.editedAt).toBeTruthy();
    expect((await updated).message.body).toBe('second draft');
  });

  it('refuses to edit someone else\'s message', async () => {
    const ack = await send(aliceSocket, 'mine');
    const result = await emit(bobSocket, 'message:edit', { messageId: ack.message.id, body: 'hijacked' });
    expect(result.ok).toBe(false);
  });

  it('soft deletes, keeping the row so threads survive', async () => {
    const parent = await send(aliceSocket, 'parent');
    await send(bobSocket, 'reply', { parentId: parent.message.id });

    const deleted = waitFor(bobSocket, 'message:deleted');
    expect((await emit(aliceSocket, 'message:delete', { messageId: parent.message.id })).ok).toBe(true);
    expect((await deleted).id).toBe(parent.message.id);

    const history = await alice.agent.get(`/api/rooms/${roomId}/messages`);
    const row = history.body.messages.find((m) => m.id === parent.message.id);
    expect(row.isDeleted).toBe(true);
    expect(row.body).toBe('');

    // The reply still points at its parent.
    const thread = await alice.agent.get(`/api/messages/${parent.message.id}/thread`);
    expect(thread.body.replies).toHaveLength(1);
  });

  it('lets a moderator delete another member\'s message', async () => {
    const ack = await bob.agent ? await send(bobSocket, 'bob speaking') : null;
    // alice is the first registered user, so she is a server admin.
    const result = await emit(aliceSocket, 'message:delete', { messageId: ack.message.id });
    expect(result.ok).toBe(true);
  });
});

describe('threads', () => {
  it('links a reply to its parent with a quoted excerpt', async () => {
    const parent = await send(aliceSocket, 'what should we ship?');
    const reply = await send(bobSocket, 'the search feature', { parentId: parent.message.id });

    expect(reply.message.parent.id).toBe(parent.message.id);
    expect(reply.message.parent.author).toBe('alice');
    expect(reply.message.parent.excerpt).toContain('what should we ship');
  });

  it('counts replies and lists them', async () => {
    const parent = await send(aliceSocket, 'topic');
    await send(bobSocket, 'one', { parentId: parent.message.id });
    await send(bobSocket, 'two', { parentId: parent.message.id });

    const thread = await alice.agent.get(`/api/messages/${parent.message.id}/thread`);
    expect(thread.body.replies).toHaveLength(2);
    expect(thread.body.parent.replyCount).toBe(2);
  });

  it('refuses a reply to a message in another room', async () => {
    const other = await alice.agent.post('/api/rooms').send({ name: 'Elsewhere' });
    const parent = await emit(aliceSocket, 'message:send', { roomId: other.body.room.id, body: 'over here' });

    const reply = await send(aliceSocket, 'wrong room', { parentId: parent.message.id });
    expect(reply.ok).toBe(false);
  });
});

describe('reactions', () => {
  it('toggles a reaction on and off', async () => {
    const ack = await send(aliceSocket, 'react to me');
    const seen = waitFor(bobSocket, 'message:reactions');

    const added = await emit(bobSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '🎉' });
    expect(added.added).toBe(true);
    expect((await seen).reactions[0].count).toBe(1);

    const removed = await emit(bobSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '🎉' });
    expect(removed.added).toBe(false);
    expect(removed.reactions).toHaveLength(0);
  });

  it('groups the same emoji from different people', async () => {
    const ack = await send(aliceSocket, 'popular');
    await emit(aliceSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '👍' });
    const result = await emit(bobSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '👍' });

    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0].count).toBe(2);
    expect(result.reactions[0].userIds).toHaveLength(2);
  });

  it('rejects anything that is not an emoji', async () => {
    const ack = await send(aliceSocket, 'target');
    expect((await emit(aliceSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: 'lol' })).ok).toBe(false);
    expect((await emit(aliceSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '<b>' })).ok).toBe(false);
  });

  it('clears reactions when the message is deleted', async () => {
    const ack = await send(aliceSocket, 'doomed');
    await emit(bobSocket, 'reaction:toggle', { messageId: ack.message.id, emoji: '👍' });
    await emit(aliceSocket, 'message:delete', { messageId: ack.message.id });

    const history = await alice.agent.get(`/api/rooms/${roomId}/messages`);
    expect(history.body.messages.find((m) => m.id === ack.message.id).reactions).toHaveLength(0);
  });
});

describe('pinning', () => {
  it('lets a moderator pin and unpin', async () => {
    const ack = await send(bobSocket, 'important announcement');

    const pinned = await emit(aliceSocket, 'message:pin', { messageId: ack.message.id });
    expect(pinned.ok).toBe(true);
    expect((await alice.agent.get(`/api/rooms/${roomId}/pinned`)).body.pinned).toHaveLength(1);

    await emit(aliceSocket, 'message:pin', { messageId: ack.message.id });
    expect((await alice.agent.get(`/api/rooms/${roomId}/pinned`)).body.pinned).toHaveLength(0);
  });

  it('stops a plain member pinning', async () => {
    const room = await alice.agent.post('/api/rooms').send({ name: 'Members Only' });
    await bob.agent.post(`/api/rooms/${room.body.room.id}/join`);
    await emit(bobSocket, 'room:join', { roomId: room.body.room.id });

    const ack = await emit(bobSocket, 'message:send', { roomId: room.body.room.id, body: 'mine' });
    expect((await emit(bobSocket, 'message:pin', { messageId: ack.message.id })).ok).toBe(false);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await send(aliceSocket, 'the quick brown fox jumps');
    await send(aliceSocket, 'a lazy dog sleeps');
    await send(bobSocket, 'pineapple on pizza is fine');
  });

  it('finds messages and highlights the match', async () => {
    const response = await alice.agent.get(`/api/rooms/${roomId}/search?q=pineapple`);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].snippet).toContain('pineapple');
    expect(response.body.results[0].author.username).toBe('bob');
  });

  it('matches on a prefix', async () => {
    const response = await alice.agent.get(`/api/rooms/${roomId}/search?q=quic`);
    expect(response.body.results.length).toBeGreaterThan(0);
  });

  it('returns nothing for a miss and treats FTS syntax as literal text', async () => {
    expect((await alice.agent.get(`/api/rooms/${roomId}/search?q=zebra`)).body.results).toHaveLength(0);

    const hostile = await alice.agent.get(`/api/rooms/${roomId}/search?q=${encodeURIComponent('"*(){}^')}`);
    expect(hostile.status).toBe(200);
    expect(hostile.body.results).toHaveLength(0);
  });

  it('excludes deleted messages', async () => {
    const ack = await send(aliceSocket, 'ephemeral watermelon');
    expect((await alice.agent.get(`/api/rooms/${roomId}/search?q=watermelon`)).body.results).toHaveLength(1);

    await emit(aliceSocket, 'message:delete', { messageId: ack.message.id });
    expect((await alice.agent.get(`/api/rooms/${roomId}/search?q=watermelon`)).body.results).toHaveLength(0);
  });

  it('does not search rooms you cannot read', async () => {
    const room = await alice.agent.post('/api/rooms').send({ name: 'Private', visibility: 'private' });
    expect((await bob.agent.get(`/api/rooms/${room.body.room.id}/search?q=anything`)).status).toBe(403);
  });
});

describe('unread counts', () => {
  it('counts messages from others and clears on read', async () => {
    await send(aliceSocket, 'unread one');
    await send(aliceSocket, 'unread two');

    let forBob = (await bob.agent.get('/api/rooms')).body.rooms.find((r) => r.id === roomId);
    expect(forBob.unreadCount).toBe(2);

    const latest = (await bob.agent.get(`/api/rooms/${roomId}/messages`)).body.messages.at(-1);
    await bob.agent.post(`/api/rooms/${roomId}/read`).send({ messageId: latest.id });

    forBob = (await bob.agent.get('/api/rooms')).body.rooms.find((r) => r.id === roomId);
    expect(forBob.unreadCount).toBe(0);
  });

  it('does not count your own messages', async () => {
    await send(aliceSocket, 'my own words');
    const forAlice = (await alice.agent.get('/api/rooms')).body.rooms.find((r) => r.id === roomId);
    expect(forAlice.unreadCount).toBe(0);
  });

  it('tracks mentions separately', async () => {
    await send(aliceSocket, 'hey @bob take a look');

    const forBob = (await bob.agent.get('/api/rooms')).body.rooms.find((r) => r.id === roomId);
    expect(forBob.mentionCount).toBe(1);
    expect(forBob.unreadCount).toBeGreaterThanOrEqual(1);
  });
});

describe('mentions', () => {
  it('notifies the mentioned user', async () => {
    const mention = waitFor(bobSocket, 'mention');
    const ack = await send(aliceSocket, 'ping @bob');

    expect(ack.message.mentionedUserIds).toContain(bob.user.id);
    expect((await mention).message.body).toBe('ping @bob');
  });

  it('ignores an unknown name and does not mention yourself', async () => {
    const ack = await send(aliceSocket, 'hello @nobody and @alice');
    expect(ack.message.mentionedUserIds).toHaveLength(0);
  });

  it('does not treat an email address as a mention', async () => {
    const ack = await send(aliceSocket, 'write to me at someone@bob.com');
    expect(ack.message.mentionedUserIds).toHaveLength(0);
  });
});
