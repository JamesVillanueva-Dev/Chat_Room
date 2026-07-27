'use strict';

const dns = require('dns').promises;
const net = require('net');

const config = require('../config');
const linkPreviews = require('../db/repositories/linkPreviews');
const logger = require('../logger').child({ component: 'unfurl' });
const metrics = require('./metrics');

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]{}"']+/i;
const MAX_REDIRECTS = 3;

const firstUrl = (body) => {
  const match = URL_PATTERN.exec(String(body || ''));
  if (!match) return null;
  // Trailing punctuation is almost always sentence punctuation, not the URL.
  const cleaned = match[0].replace(/[.,;:!?]+$/, '');
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * True for addresses that live inside the network running this server.
 * The unfurler follows user-supplied links, so without this check a message
 * could make the server probe its own private network (SSRF).
 */
const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return false;
  }

  return true;
};

const assertPublicHost = async (hostname) => {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`blocked private address ${hostname}`);
    return;
  }

  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) throw new Error(`could not resolve ${hostname}`);
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new Error(`blocked private address ${record.address} for ${hostname}`);
    }
  }
};

const decodeEntities = (value) =>
  String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

const metaContent = (html, keys) => {
  for (const key of keys) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
      'i'
    );
    const tag = pattern.exec(html)?.[0];
    if (!tag) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
};

const parseMetadata = (html, baseUrl) => {
  const title =
    metaContent(html, ['og:title', 'twitter:title']) ||
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '') ||
    null;

  const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
  const siteName = metaContent(html, ['og:site_name']);
  const rawImage = metaContent(html, ['og:image', 'og:image:url', 'twitter:image']);

  let imageUrl = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        imageUrl = resolved.toString();
      }
    } catch {
      imageUrl = null;
    }
  }

  const clamp = (value, max) => (value && value.length > max ? `${value.slice(0, max - 1)}…` : value);

  return {
    title: clamp(title, 180),
    description: clamp(description, 300),
    siteName: clamp(siteName, 80),
    imageUrl,
  };
};

/** Reads at most `maxBytes` of the body so a huge page cannot exhaust memory. */
const readCapped = async (response, maxBytes) => {
  const reader = response.body?.getReader?.();
  if (!reader) return '';

  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
};

const fetchMetadata = async (startUrl) => {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.unfurl.timeoutMs);

    let response;
    try {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'user-agent': config.unfurl.userAgent,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { status: 'empty' };
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) return { status: 'error' };

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) return { status: 'empty' };

    const html = await readCapped(response, config.unfurl.maxBytes);
    const metadata = parseMetadata(html, current);
    if (!metadata.title && !metadata.description && !metadata.imageUrl) {
      return { status: 'empty' };
    }
    return { status: 'ok', ...metadata };
  }

  return { status: 'error' };
};

/**
 * Returns a cached preview immediately when one is fresh, otherwise fetches and
 * stores it. Failures are cached too, so a dead link is not retried on every
 * message that mentions it.
 */
const unfurl = async (url) => {
  if (!config.unfurl.enabled) return null;

  const cached = linkPreviews.find(url);
  if (linkPreviews.isFresh(cached)) {
    return cached.status === 'ok' ? cached : null;
  }

  let result;
  try {
    result = await fetchMetadata(url);
    metrics.increment('unfurls');
  } catch (error) {
    logger.debug('unfurl failed', { url, error: error.message });
    result = { status: 'error' };
  }

  const stored = linkPreviews.upsert(url, result);
  return stored.status === 'ok' ? stored : null;
};

module.exports = { firstUrl, unfurl, parseMetadata, isPrivateAddress, decodeEntities };
