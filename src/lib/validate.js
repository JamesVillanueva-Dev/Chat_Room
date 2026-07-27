'use strict';

const config = require('../config');
const { ValidationError } = require('./errors');

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]{1,2}$/i;

// Names that would let someone impersonate the server's own messages.
const RESERVED_USERNAMES = new Set([
  'system',
  'admin',
  'administrator',
  'bot',
  'rpsbot',
  'rps-bot',
  'moderator',
  'everyone',
  'here',
  'chatroom',
  'me',
]);

const requireString = (value, field) => {
  if (typeof value !== 'string') throw new ValidationError(`${field} is required.`, field);
  return value;
};

const username = (value) => {
  const trimmed = requireString(value, 'username').trim();
  const { minUsernameLength, maxUsernameLength } = config.chat;

  if (trimmed.length < minUsernameLength) {
    throw new ValidationError(`Username must be at least ${minUsernameLength} characters.`, 'username');
  }
  if (trimmed.length > maxUsernameLength) {
    throw new ValidationError(`Username must be at most ${maxUsernameLength} characters.`, 'username');
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new ValidationError(
      'Username may use letters, numbers, dot, dash and underscore, and must start and end with a letter or number.',
      'username'
    );
  }
  if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
    throw new ValidationError('That username is reserved.', 'username');
  }
  return trimmed;
};

const password = (value) => {
  const raw = requireString(value, 'password');
  if (raw.length < config.chat.minPasswordLength) {
    throw new ValidationError(
      `Password must be at least ${config.chat.minPasswordLength} characters.`,
      'password'
    );
  }
  // bcrypt silently truncates past 72 bytes, so reject rather than mislead.
  if (Buffer.byteLength(raw, 'utf8') > 72) {
    throw new ValidationError('Password must be at most 72 bytes.', 'password');
  }
  return raw;
};

const messageBody = (value, { allowEmpty = false } = {}) => {
  const raw = requireString(value, 'message');
  // Collapse runs of blank lines but keep intentional single line breaks.
  const trimmed = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new ValidationError('Message cannot be empty.', 'message');
  }
  if (trimmed.length > config.chat.maxMessageLength) {
    throw new ValidationError(
      `Message must be at most ${config.chat.maxMessageLength} characters.`,
      'message'
    );
  }
  return trimmed;
};

const boundedText = (value, { field, max, fallback = '' }) => {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).replace(/\s+/g, ' ').trim();
  if (raw.length > max) {
    throw new ValidationError(`${field} must be at most ${max} characters.`, field);
  }
  return raw;
};

const roomName = (value) => {
  const name = boundedText(value, { field: 'name', max: config.chat.maxRoomNameLength });
  if (name.length < 2) throw new ValidationError('Room name must be at least 2 characters.', 'name');
  if (!/[a-z0-9]/i.test(name)) {
    throw new ValidationError('Room name needs at least one letter or number.', 'name');
  }
  return name;
};

const presence = (value) => {
  const allowed = ['online', 'away', 'busy', 'offline'];
  if (!allowed.includes(value)) throw new ValidationError('Unknown presence value.', 'presence');
  return value;
};

const visibility = (value) => {
  if (!['public', 'private'].includes(value)) {
    throw new ValidationError('Visibility must be public or private.', 'visibility');
  }
  return value;
};

/**
 * Emoji reactions come from a client-side picker, but the socket accepts
 * arbitrary strings, so cap length and require it to actually be emoji.
 */
const emoji = (value) => {
  const raw = requireString(value, 'emoji').trim();
  if (raw.length === 0 || raw.length > 16) {
    throw new ValidationError('Reaction must be a single emoji.', 'emoji');
  }
  // Regional indicators (flags) are not Extended_Pictographic, so they need
  // their own clause or 🇬🇧 would be rejected as plain text.
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(raw)) {
    throw new ValidationError('Reaction must be an emoji.', 'emoji');
  }
  return raw;
};

const positiveInt = (value, field, { max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(`${field} must be a positive number.`, field);
  }
  return Math.min(parsed, max);
};

const optionalId = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  return positiveInt(value, field);
};

module.exports = {
  ValidationError,
  RESERVED_USERNAMES,
  username,
  password,
  messageBody,
  boundedText,
  roomName,
  presence,
  visibility,
  emoji,
  positiveInt,
  optionalId,
};
