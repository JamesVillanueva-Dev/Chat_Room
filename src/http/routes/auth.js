'use strict';

const express = require('express');

const authService = require('../../auth/service');
const config = require('../../config');
const metrics = require('../../services/metrics');
const users = require('../../db/repositories/users');
const {
  asyncHandler,
  destroySession,
  regenerateSession,
  requireAuth,
  saveSession,
} = require('../middleware');

const router = express.Router();

const startSession = async (req, user) => {
  // A fresh session id on sign-in prevents session fixation.
  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
};

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const user = await authService.register({
      username: req.body?.username,
      password: req.body?.password,
    });
    await startSession(req, user);
    res.status(201).json({ user });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    try {
      const user = await authService.login({
        username: req.body?.username,
        password: req.body?.password,
        ip: req.ip,
      });
      await startSession(req, user);
      res.json({ user });
    } catch (error) {
      if (error.status === 401) metrics.increment('loginFailures');
      throw error;
    }
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (userId) users.setPresence(userId, 'offline');
    await destroySession(req);
    res.clearCookie(config.session.cookieName);
    res.status(204).end();
  })
);

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.changePassword(req.user.id, {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    });
    res.status(204).end();
  })
);

module.exports = router;
