'use strict';

const crypto = require('crypto');

// Chosen to stay legible on both the light and dark surfaces.
const AVATAR_COLORS = [
  '#5b8def',
  '#7c5cff',
  '#c2569c',
  '#e0673f',
  '#d99b2b',
  '#3fa06a',
  '#2f93a8',
  '#8b6b4a',
  '#6673d8',
  '#b1524f',
];

const colorForName = (name) => {
  const digest = crypto.createHash('sha1').update(String(name).toLowerCase()).digest();
  return AVATAR_COLORS[digest[0] % AVATAR_COLORS.length];
};

const initialsFor = (name) => {
  const parts = String(name || '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const randomToken = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { AVATAR_COLORS, colorForName, initialsFor, randomToken };
