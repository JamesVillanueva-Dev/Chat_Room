'use strict';

const config = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const COLORS = {
  error: '[31m',
  warn: '[33m',
  info: '[36m',
  debug: '[90m',
};
const RESET = '[0m';
const DIM = '[90m';

const threshold = LEVELS[config.logging.level] ?? LEVELS.info;

const serializeError = (error) => ({
  message: error.message,
  name: error.name,
  ...(error.code ? { code: error.code } : {}),
  stack: error.stack,
});

const normalizeFields = (fields) => {
  if (!fields) return {};
  if (fields instanceof Error) return { error: serializeError(fields) };
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
};

const formatPretty = (level, message, fields) => {
  const time = new Date().toISOString().slice(11, 23);
  const { component, ...rest } = fields;
  const head = `${DIM}${time}${RESET} ${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const scope = component ? `${DIM}[${component}]${RESET} ` : '';
  const keys = Object.entries(rest);
  const tail = keys.length
    ? ` ${DIM}${keys
        .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join(' ')}${RESET}`
    : '';
  return `${head} ${scope}${message}${tail}`;
};

const write = (level, message, fields) => {
  if (LEVELS[level] > threshold) return;
  const normalized = normalizeFields(fields);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

  if (config.logging.pretty) {
    stream.write(`${formatPretty(level, message, normalized)}\n`);
    if (normalized.error?.stack && level === 'error') {
      stream.write(`${DIM}${normalized.error.stack}${RESET}\n`);
    }
    return;
  }

  stream.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...normalized,
    })}\n`
  );
};

const createLogger = (bindings = {}) => ({
  error: (message, fields) => write('error', message, { ...bindings, ...normalizeFields(fields) }),
  warn: (message, fields) => write('warn', message, { ...bindings, ...normalizeFields(fields) }),
  info: (message, fields) => write('info', message, { ...bindings, ...normalizeFields(fields) }),
  debug: (message, fields) => write('debug', message, { ...bindings, ...normalizeFields(fields) }),
  child: (extra) => createLogger({ ...bindings, ...extra }),
});

module.exports = createLogger();
module.exports.createLogger = createLogger;
