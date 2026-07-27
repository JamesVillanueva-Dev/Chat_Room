'use strict';

const path = require('path');

require('dotenv').config({ quiet: true });

const ROOT_DIR = path.resolve(__dirname, '..');

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const resolvePath = (value, fallback) => path.resolve(ROOT_DIR, value || fallback);

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

const DEV_SESSION_SECRET = 'insecure-development-secret-do-not-use-in-production';

const resolveSessionSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (isProduction) {
    throw new Error(
      'SESSION_SECRET must be set when NODE_ENV=production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return DEV_SESSION_SECRET;
};

// Uploads are matched on both MIME type and extension so a renamed executable
// cannot ride in on a spoofed Content-Type. SVG is deliberately absent: it can
// carry script and would run same-origin when opened from /uploads.
const UPLOAD_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.log', '.md'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/zip': ['.zip'],
};

const config = Object.freeze({
  env,
  isProduction,
  isTest,
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),

  server: Object.freeze({
    port: toInt(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    trustProxy: toBool(process.env.TRUST_PROXY, false),
    shutdownGraceMs: toInt(process.env.SHUTDOWN_GRACE_MS, 10000),
  }),

  session: Object.freeze({
    secret: resolveSessionSecret(),
    cookieName: process.env.SESSION_COOKIE_NAME || 'chatroom.sid',
    maxAgeMs: toInt(process.env.SESSION_MAX_AGE_DAYS, 30) * 24 * 60 * 60 * 1000,
    secureCookies: toBool(process.env.SESSION_SECURE_COOKIES, isProduction),
    pruneIntervalMs: toInt(process.env.SESSION_PRUNE_INTERVAL_MS, 15 * 60 * 1000),
  }),

  db: Object.freeze({
    file: isTest
      ? ':memory:'
      : resolvePath(process.env.DATABASE_PATH, './data/chat.db'),
    verbose: toBool(process.env.DATABASE_VERBOSE, false),
  }),

  uploads: Object.freeze({
    dir: resolvePath(process.env.UPLOAD_DIR, './public/uploads'),
    publicPath: '/uploads',
    maxBytes: toInt(process.env.UPLOAD_MAX_BYTES, 10 * 1024 * 1024),
    avatarMaxBytes: toInt(process.env.AVATAR_MAX_BYTES, 2 * 1024 * 1024),
    types: Object.freeze(UPLOAD_TYPES),
    allowedMimeTypes: Object.freeze(Object.keys(UPLOAD_TYPES)),
    imageMimeTypes: Object.freeze([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
    ]),
  }),

  chat: Object.freeze({
    historyPageSize: toInt(process.env.HISTORY_PAGE_SIZE, 40),
    maxHistoryPageSize: toInt(process.env.MAX_HISTORY_PAGE_SIZE, 100),
    searchPageSize: toInt(process.env.SEARCH_PAGE_SIZE, 25),
    maxMessageLength: toInt(process.env.MAX_MESSAGE_LENGTH, 4000),
    maxUsernameLength: 24,
    minUsernameLength: 3,
    minPasswordLength: toInt(process.env.MIN_PASSWORD_LENGTH, 8),
    maxBioLength: 280,
    maxStatusMessageLength: 80,
    maxRoomNameLength: 48,
    maxTopicLength: 160,
    defaultRoomSlug: 'general',
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, isTest ? 4 : 11),
  }),

  limits: Object.freeze({
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 10000),
    maxMessages: toInt(process.env.RATE_LIMIT_MAX_MESSAGES, 10),
    backoffMs: toInt(process.env.RATE_LIMIT_BACKOFF_MS, 2000),
    backoffMaxMs: toInt(process.env.RATE_LIMIT_BACKOFF_MAX_MS, 60000),
    connectionsPerIp: toInt(process.env.MAX_CONNECTIONS_PER_IP, 12),
    loginWindowMs: toInt(process.env.LOGIN_WINDOW_MS, 15 * 60 * 1000),
    loginMaxAttempts: toInt(process.env.LOGIN_MAX_ATTEMPTS, 10),
  }),

  unfurl: Object.freeze({
    enabled: toBool(process.env.UNFURL_ENABLED, !isTest),
    timeoutMs: toInt(process.env.UNFURL_TIMEOUT_MS, 4000),
    cacheTtlMs: toInt(process.env.UNFURL_CACHE_TTL_MINUTES, 1440) * 60 * 1000,
    maxBytes: toInt(process.env.UNFURL_MAX_BYTES, 512 * 1024),
    userAgent: process.env.UNFURL_USER_AGENT || 'ChatRoomBot/1.0 (+link-preview)',
  }),

  logging: Object.freeze({
    level: process.env.LOG_LEVEL || (isTest ? 'error' : 'info'),
    pretty: toBool(process.env.LOG_PRETTY, !isProduction),
  }),

  metrics: Object.freeze({
    // When set, /metrics also accepts this bearer token so a monitoring agent
    // can scrape it without an admin session.
    token: process.env.METRICS_TOKEN || null,
  }),

  rps: Object.freeze({
    enabled: toBool(process.env.RPS_ENABLED, true),
    pythonBin: process.env.PYTHON || 'python',
    scriptPath: path.join(ROOT_DIR, 'public', 'RPS.py'),
    timeoutMs: toInt(process.env.RPS_TIMEOUT_MS, 5000),
  }),
});

module.exports = config;
