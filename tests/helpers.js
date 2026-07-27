import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The application is CommonJS; load it through require so tests exercise the
// same module instances the server does.
export const db = require('../src/db');
export const config = require('../src/config');
export const usersRepo = require('../src/db/repositories/users');
export const roomsRepo = require('../src/db/repositories/rooms');
export const messagesRepo = require('../src/db/repositories/messages');
export const { createServer } = require('../server');

const request = require('supertest');
const { io: ioClient } = require('socket.io-client');

export { request };

export const resetDatabase = () => db.resetDatabase();

/** Boots the real server on an ephemeral port. */
export const startServer = async () => {
  const { httpServer, realtime, app } = createServer();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;

  return {
    app,
    httpServer,
    realtime,
    port,
    url: `http://127.0.0.1:${port}`,
    async close() {
      realtime.detach();
      await new Promise((resolve) => realtime.io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
};

/** Registers a user over HTTP and returns an agent plus the raw cookie header. */
export const registerUser = async (target, username, password = 'password123') => {
  const agent = request.agent(target);
  const response = await agent.post('/api/auth/register').send({ username, password });
  if (response.status !== 201) {
    throw new Error(`register ${username} failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const cookie = response.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
  return { agent, cookie, user: response.body.user };
};

/**
 * Connects a socket for a user. `forceNew` is essential: socket.io-client
 * caches one Manager per URL, so without it every client in a test would share
 * a single connection.
 */
export const connectSocket = (url, cookie, options = {}) =>
  ioClient(url, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...options,
  });

export const waitFor = (socket, event, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Waits for the first payload matching `predicate`, ignoring other traffic. */
export const waitForMatch = (socket, event, predicate, timeout = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timed out waiting for a matching "${event}"`));
    }, timeout);

    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });

/** Emits and resolves with the server's acknowledgement. */
export const emit = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for "${event}"`)), 10000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

export const connectReady = async (url, cookie, options) => {
  const socket = connectSocket(url, cookie, options);
  const ready = await waitFor(socket, 'ready');
  return { socket, ready };
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
