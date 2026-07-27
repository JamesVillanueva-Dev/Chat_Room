'use strict';

const slugify = (value, { maxLength = 40 } = {}) =>
  String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

const collapseWhitespace = (value) => String(value).replace(/[ \t]+/g, ' ').trim();

/** Trims a message body down to a one-line preview for reply quotes and sidebars. */
const excerpt = (value, length = 90) => {
  const flat = String(value || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  return `${flat.slice(0, length - 1).trimEnd()}…`;
};

module.exports = { slugify, collapseWhitespace, excerpt };
