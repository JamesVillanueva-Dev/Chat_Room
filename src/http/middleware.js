'use strict';

const users = require('../db/repositories/users');
const logger = require('../logger').child({ component: 'http' });
const metrics = require('../services/metrics');
const { AppError, AuthError, ForbiddenError } = require('../lib/errors');

/** Lets route handlers be async without every one of them wrapping in try/catch. */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

/**
 * Resolves the signed-in user fresh from the database on every request, so a
 * ban or role change takes effect immediately rather than at next sign-in.
 */
const attachUser = (req, res, next) => {
  req.user = null;
  const userId = req.session?.userId;
  if (!userId) return next();

  const user = users.findById(userId);
  if (!user || user.isBanned) {
    return req.session.destroy(() => next());
  }

  req.user = user;
  return next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) return next(new AuthError());
  return next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return next(new AuthError());
  if (req.user.role !== 'admin') return next(new ForbiddenError('Admin access required.'));
  return next();
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Not found.' });
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
const errorHandler = (error, req, res, next) => {
  const status = error.status || (error instanceof AppError ? error.status : 500);

  if (status >= 500) {
    metrics.increment('httpErrors');
    logger.error('request failed', {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id || null,
      error,
    });
  } else {
    logger.debug('request rejected', {
      method: req.method,
      path: req.originalUrl,
      status,
      message: error.message,
    });
  }

  if (error.retryAfterMs) {
    res.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
  }

  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server.' : error.message,
    ...(error.field ? { field: error.field } : {}),
    ...(error.code ? { code: error.code } : {}),
  });
};

/** Promisified session helpers; express-session is callback based. */
const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

const saveSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });

const destroySession = (req) =>
  new Promise((resolve) => {
    if (!req.session) return resolve();
    return req.session.destroy(() => resolve());
  });

const requestLogger = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.debug('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    });
  });
  next();
};

module.exports = {
  asyncHandler,
  attachUser,
  requireAuth,
  requireAdmin,
  notFoundHandler,
  errorHandler,
  regenerateSession,
  saveSession,
  destroySession,
  requestLogger,
};
