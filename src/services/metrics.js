'use strict';

const ONE_MINUTE = 60 * 1000;

const state = {
  startedAt: Date.now(),
  connections: 0,
  peakConnections: 0,
  totalConnections: 0,
  messagesSent: 0,
  commandsRun: 0,
  rateLimitHits: 0,
  uploads: 0,
  unfurls: 0,
  socketErrors: 0,
  httpErrors: 0,
  loginFailures: 0,
  // Timestamps of recent messages, trimmed to the last minute.
  recentMessages: [],
};

const trimRecent = (now) => {
  const cutoff = now - ONE_MINUTE;
  while (state.recentMessages.length > 0 && state.recentMessages[0] < cutoff) {
    state.recentMessages.shift();
  }
};

const connectionOpened = () => {
  state.connections += 1;
  state.totalConnections += 1;
  state.peakConnections = Math.max(state.peakConnections, state.connections);
};

const connectionClosed = () => {
  state.connections = Math.max(0, state.connections - 1);
};

const messageSent = () => {
  const now = Date.now();
  state.messagesSent += 1;
  state.recentMessages.push(now);
  trimRecent(now);
};

const increment = (key, amount = 1) => {
  if (key in state) state[key] += amount;
};

const snapshot = (extra = {}) => {
  const now = Date.now();
  trimRecent(now);
  const memory = process.memoryUsage();

  return {
    uptimeSeconds: Math.round((now - state.startedAt) / 1000),
    startedAt: new Date(state.startedAt).toISOString(),
    connections: {
      active: state.connections,
      peak: state.peakConnections,
      total: state.totalConnections,
    },
    messages: {
      total: state.messagesSent,
      lastMinute: state.recentMessages.length,
    },
    activity: {
      commandsRun: state.commandsRun,
      uploads: state.uploads,
      unfurls: state.unfurls,
      rateLimitHits: state.rateLimitHits,
      loginFailures: state.loginFailures,
    },
    errors: {
      socket: state.socketErrors,
      http: state.httpErrors,
    },
    memory: {
      rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
    },
    ...extra,
  };
};

const reset = () => {
  state.startedAt = Date.now();
  state.connections = 0;
  state.peakConnections = 0;
  state.totalConnections = 0;
  state.messagesSent = 0;
  state.commandsRun = 0;
  state.rateLimitHits = 0;
  state.uploads = 0;
  state.unfurls = 0;
  state.socketErrors = 0;
  state.httpErrors = 0;
  state.loginFailures = 0;
  state.recentMessages = [];
};

module.exports = {
  connectionOpened,
  connectionClosed,
  messageSent,
  increment,
  snapshot,
  reset,
};
