import { state, emit } from './state.js';

const OUTBOX_KEY = 'chatroom.outbox';
const ACK_TIMEOUT_MS = 12000;

/**
 * Wraps the socket.io client with an outbox.
 *
 * Anything sent while disconnected is queued in localStorage and replayed in
 * order once the connection returns, so a message typed during a dropout is not
 * silently lost. Each queued item carries a clientId, which the server echoes
 * back so the optimistic bubble can be reconciled instead of duplicated.
 */
class ChatSocket {
  constructor() {
    this.socket = null;
    this.outbox = this.loadOutbox();
    this.handlers = new Map();
    this.flushing = false;
  }

  loadOutbox() {
    try {
      const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  saveOutbox() {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(this.outbox.slice(-50)));
    } catch {
      // A full or unavailable storage is not worth breaking sending over.
    }
    state.pendingCount = this.outbox.length;
    emit('pending');
  }

  connect() {
    this.socket = window.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      // Randomised so a server restart does not bring every client back at once.
      randomizationFactor: 0.5,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.setStatus('online');
      this.flush();
    });

    this.socket.on('disconnect', (reason) => {
      this.setStatus(reason === 'io server disconnect' ? 'ended' : 'offline');
    });

    this.socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));
    this.socket.on('connect_error', () => this.setStatus('offline'));

    for (const [event, handler] of this.handlers) {
      this.socket.on(event, handler);
    }

    return this.socket;
  }

  setStatus(status) {
    if (state.connection === status) return;
    state.connection = status;
    emit('connection', status);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    if (this.socket) this.socket.on(event, handler);
  }

  get connected() {
    return Boolean(this.socket?.connected);
  }

  /** Emits and resolves with the server's ack, rejecting if it never arrives. */
  request(event, payload) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('You are offline.'));
        return;
      }

      const timer = setTimeout(() => reject(new Error('The server did not respond.')), ACK_TIMEOUT_MS);
      this.socket.emit(event, payload, (response) => {
        clearTimeout(timer);
        if (!response) return resolve({ ok: true });
        if (response.ok === false) {
          const error = new Error(response.error || 'That did not work.');
          error.code = response.code;
          return reject(error);
        }
        return resolve(response);
      });
    });
  }

  emitFireAndForget(event, payload) {
    if (this.connected) this.socket.emit(event, payload);
  }

  /** Queues a message for delivery, immediately or when the socket returns. */
  queueMessage(payload) {
    this.outbox.push(payload);
    this.saveOutbox();
    if (this.connected) this.flush();
  }

  async flush() {
    if (this.flushing || !this.connected || this.outbox.length === 0) return;
    this.flushing = true;

    while (this.outbox.length > 0 && this.connected) {
      const next = this.outbox[0];
      try {
        const response = await this.request('message:send', next);
        this.outbox.shift();
        this.saveOutbox();
        emit('outbox:sent', { clientId: next.clientId, response });
      } catch (error) {
        if (!this.connected) break;
        // A rejection from the server (too long, muted, rate limited) will not
        // succeed on retry, so drop it and tell the user rather than looping.
        this.outbox.shift();
        this.saveOutbox();
        emit('outbox:failed', { clientId: next.clientId, error: error.message });
      }
    }

    this.flushing = false;
  }

  disconnect() {
    this.socket?.disconnect();
  }
}

export const chatSocket = new ChatSocket();
