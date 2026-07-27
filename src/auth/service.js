'use strict';

const config = require('../config');
const db = require('../db');
const users = require('../db/repositories/users');
const rooms = require('../db/repositories/rooms');
const logger = require('../logger').child({ component: 'auth' });
const passwords = require('./passwords');
const validate = require('../lib/validate');
const { AuthError, ConflictError, ForbiddenError, RateLimitError } = require('../lib/errors');

/**
 * Sliding-window counter for failed logins, keyed by client IP. In memory on
 * purpose: it protects a single process and should reset on restart.
 */
class LoginThrottle {
  constructor({ windowMs = config.limits.loginWindowMs, max = config.limits.loginMaxAttempts } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.attempts = new Map();
  }

  check(key) {
    const entry = this.attempts.get(key);
    if (!entry) return;
    if (Date.now() - entry.firstAt > this.windowMs) {
      this.attempts.delete(key);
      return;
    }
    if (entry.count >= this.max) {
      const retryAfterMs = this.windowMs - (Date.now() - entry.firstAt);
      throw new RateLimitError(
        `Too many sign-in attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minute(s).`,
        retryAfterMs
      );
    }
  }

  recordFailure(key) {
    const entry = this.attempts.get(key);
    if (!entry || Date.now() - entry.firstAt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAt: Date.now() });
      return;
    }
    entry.count += 1;
  }

  reset(key) {
    this.attempts.delete(key);
  }

  clear() {
    this.attempts.clear();
  }
}

const loginThrottle = new LoginThrottle();

/**
 * Creates an account. The very first account becomes the global admin, since
 * a fresh install otherwise has nobody who can moderate.
 */
const register = async ({ username, password }) => {
  const cleanUsername = validate.username(username);
  const cleanPassword = validate.password(password);

  if (users.findByUsername(cleanUsername)) {
    throw new ConflictError('That username is already taken.', 'username');
  }

  const isFirstUser = users.countUsers() === 0;
  const passwordHash = await passwords.hash(cleanPassword);

  let user;
  try {
    user = users.createUser({
      username: cleanUsername,
      passwordHash,
      role: isFirstUser ? 'admin' : 'user',
    });
  } catch (error) {
    // UNIQUE violation means someone registered the same name in between.
    if (/UNIQUE/i.test(error.message)) {
      throw new ConflictError('That username is already taken.', 'username');
    }
    throw error;
  }

  const defaultRoom = rooms.findBySlug(config.chat.defaultRoomSlug);
  if (defaultRoom) rooms.addMember(defaultRoom.id, user.id, isFirstUser ? 'owner' : 'member');

  logger.info('user registered', { userId: user.id, username: user.username, admin: isFirstUser });
  return user;
};

const login = async ({ username, password, ip = 'unknown' }) => {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new AuthError('Enter both a username and a password.');
  }

  loginThrottle.check(ip);

  const credentials = users.findCredentialsByUsername(username.trim());
  if (!credentials) {
    // Spend the same time as a real comparison so timing does not reveal
    // whether the account exists.
    await passwords.burnCycles();
    loginThrottle.recordFailure(ip);
    throw new AuthError('Incorrect username or password.');
  }

  const matches = await passwords.verify(password, credentials.password_hash);
  if (!matches) {
    loginThrottle.recordFailure(ip);
    throw new AuthError('Incorrect username or password.');
  }

  if (credentials.banned_at) {
    throw new ForbiddenError(
      credentials.banned_reason
        ? `This account is banned: ${credentials.banned_reason}`
        : 'This account is banned.'
    );
  }

  loginThrottle.reset(ip);
  const user = users.findById(credentials.id);
  logger.info('user signed in', { userId: user.id, username: user.username });
  return user;
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = users.findById(userId);
  if (!user) throw new AuthError();

  const credentials = users.findCredentialsByUsername(user.username);
  const matches = await passwords.verify(currentPassword || '', credentials.password_hash);
  if (!matches) throw new AuthError('Current password is incorrect.');

  const cleanPassword = validate.password(newPassword);
  const hash = await passwords.hash(cleanPassword);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, userId);
  logger.info('password changed', { userId });
};

module.exports = { register, login, changePassword, loginThrottle, LoginThrottle };
