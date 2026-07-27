'use strict';

const config = require('../../config');
const db = require('../index');

const toPreview = (row) => {
  if (!row) return null;
  return {
    url: row.url,
    status: row.status,
    title: row.title || null,
    description: row.description || null,
    imageUrl: row.image_url || null,
    siteName: row.site_name || null,
    fetchedAt: row.fetched_at,
  };
};

const find = (url) => toPreview(db.get('SELECT * FROM link_previews WHERE url = ?', url));

const isFresh = (preview) =>
  Boolean(preview) && Date.now() - new Date(preview.fetchedAt).getTime() < config.unfurl.cacheTtlMs;

const upsert = (url, { status = 'ok', title = null, description = null, imageUrl = null, siteName = null }) => {
  db.run(
    `INSERT INTO link_previews (url, status, title, description, image_url, site_name, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET
       status      = excluded.status,
       title       = excluded.title,
       description = excluded.description,
       image_url   = excluded.image_url,
       site_name   = excluded.site_name,
       fetched_at  = excluded.fetched_at`,
    url,
    status,
    title,
    description,
    imageUrl,
    siteName,
    new Date().toISOString()
  );
  return find(url);
};

const countPreviews = () => db.pluck('SELECT COUNT(*) FROM link_previews');

module.exports = { find, isFresh, upsert, countPreviews };
