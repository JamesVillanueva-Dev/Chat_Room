'use strict';

const path = require('path');

const express = require('express');

const config = require('../config');
const db = require('../db');
const messagesRepo = require('../db/repositories/messages');
const rooms = require('../db/repositories/rooms');
const users = require('../db/repositories/users');
const metrics = require('../services/metrics');
const { sessionMiddleware } = require('../auth/session');
const {
  attachUser,
  errorHandler,
  notFoundHandler,
  requestLogger,
} = require('./middleware');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

const securityHeaders = (req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "script-src 'self'",
      // Inline *styles* are needed for avatar colours, textarea autosizing and
      // popover placement. Inline scripts stay blocked, and since the client
      // builds every node with createElement/textContent there is no path for
      // user content to become a style attribute.
      "style-src 'self' 'unsafe-inline'",
      // Link previews legitimately point at images on other hosts.
      "img-src 'self' data: https:",
      "connect-src 'self' ws: wss:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
};

/** /metrics accepts an admin session, or a bearer token when one is configured. */
const allowMetrics = (req) => {
  if (req.user?.role === 'admin') return true;
  if (!config.metrics.token) return false;
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  return bearer === config.metrics.token || req.query.token === config.metrics.token;
};

const createApp = () => {
  const app = express();

  if (config.server.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(requestLogger);
  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use(sessionMiddleware);
  app.use(attachUser);

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/metrics', (req, res) => {
    if (!allowMetrics(req)) {
      return res.status(403).json({ error: 'Metrics require an admin session or a metrics token.' });
    }

    return res.json(
      metrics.snapshot({
        database: {
          driver: db.name,
          users: users.countUsers(),
          rooms: rooms.countRooms({ kind: 'room' }),
          directMessages: rooms.countRooms({ kind: 'dm' }),
          messages: messagesRepo.countMessages(),
        },
      })
    );
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/rooms', require('./routes/rooms'));
  app.use('/api/messages', require('./routes/messages'));
  app.use('/api/dms', require('./routes/dms'));
  app.use('/api/invites', require('./routes/invites'));
  app.use('/api/admin', require('./routes/admin'));

  app.use(
    config.uploads.publicPath,
    express.static(config.uploads.dir, {
      maxAge: '7d',
      index: false,
      setHeaders: (res, filePath) => {
        res.set('X-Content-Type-Options', 'nosniff');
        // Anything that is not a known image is downloaded rather than rendered,
        // so an uploaded document can never execute in the app's origin.
        if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
          res.set('Content-Disposition', 'attachment');
        }
      },
    })
  );

  // Caching the client in development just serves stale code after an edit.
  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      maxAge: config.isProduction ? '1h' : 0,
      etag: true,
    })
  );

  // Invite links are deep links into the single-page client.
  app.get('/invite/:code', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
