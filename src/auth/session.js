'use strict';

const session = require('express-session');

const config = require('../config');
const { SqliteSessionStore } = require('./sessionStore');

const sessionStore = new SqliteSessionStore();

const sessionMiddleware = session({
  name: config.session.cookieName,
  secret: config.session.secret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secureCookies,
    maxAge: config.session.maxAgeMs,
  },
});

module.exports = { sessionMiddleware, sessionStore };
