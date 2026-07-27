'use strict';

const http = require('http');

const config = require('./src/config');
const db = require('./src/db');
const logger = require('./src/logger');
const users = require('./src/db/repositories/users');
const { attachRealtime } = require('./src/realtime');
const { createApp } = require('./src/http/app');
const { sessionStore } = require('./src/auth/session');

/**
 * Builds the HTTP server and its realtime layer without listening, so tests can
 * drive the same wiring the real process uses.
 */
const createServer = () => {
  const app = createApp();
  const httpServer = http.createServer(app);
  const realtime = attachRealtime(httpServer);
  return { app, httpServer, realtime };
};

const start = () => {
  // Presence is per-process state; anyone marked online belongs to a run that
  // is already over.
  const stale = users.markAllOffline();
  if (stale > 0) logger.debug('cleared stale presence', { count: stale });

  const { app, httpServer, realtime } = createServer();

  httpServer.listen(config.server.port, config.server.host, () => {
    logger.info('chat server listening', {
      url: `http://localhost:${config.server.port}`,
      host: config.server.host,
      env: config.env,
      driver: db.name,
    });
  });

  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.server.port} is already in use. Set PORT to something else.`);
      process.exit(1);
    }
    throw error;
  });

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });

    // Anything still running past the grace period is not going to finish.
    const forceExit = setTimeout(() => {
      logger.warn('shutdown timed out, exiting now');
      process.exit(1);
    }, config.server.shutdownGraceMs);
    forceExit.unref();

    try {
      realtime.io.emit('server:shutdown', { message: 'The server is restarting.' });
      realtime.detach();

      await new Promise((resolve) => realtime.io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));

      users.markAllOffline();
      sessionStore.close();
      db.close();

      logger.info('shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error('shutdown failed', { error });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', {
      error: reason instanceof Error ? reason : new Error(String(reason)),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error });
    shutdown('uncaughtException');
  });

  return { app, httpServer, realtime, shutdown };
};

if (require.main === module) {
  start();
}

module.exports = { createServer, start };
