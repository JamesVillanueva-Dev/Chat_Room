import { el } from './dom.js';

/**
 * A deliberately small markdown renderer that outputs DOM nodes.
 *
 * Nothing here ever produces an HTML string, so message text cannot introduce
 * markup: every piece of user content reaches the page as a text node, and the
 * only elements created are the ones this file decides to create. Links are
 * additionally restricted to http/https.
 */

// Order matters — inline code is matched first so its contents stay literal.
const INLINE_PATTERN = new RegExp(
  [
    '(?<code>`[^`\\n]+`)',
    '(?<bold>\\*\\*[^*\\n]+\\*\\*)',
    // Underscore emphasis only applies at word boundaries, so snake_case and
    // dunder names pasted from code are left alone.
    '(?<boldAlt>(?<=^|\\s)__[^\\n]+?__(?=$|\\s|[.,!?;:]))',
    '(?<italic>\\*[^*\\n]+\\*)',
    '(?<italicAlt>(?<=^|\\s)_[^\\n]+?_(?=$|\\s|[.,!?;:]))',
    '(?<strike>~~[^~\\n]+~~)',
    '(?<link>\\[[^\\]\\n]+\\]\\([^\\s)]+\\))',
    '(?<url>https?://[^\\s<>()\\[\\]{}"\']+)',
    '(?<mention>(?<![\\w@])@[a-z0-9][a-z0-9._-]{1,23})',
  ].join('|'),
  'gi'
);

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

const safeUrl = (raw) => {
  try {
    const url = new URL(raw, window.location.origin);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const linkNode = (href, label) => {
  const safe = safeUrl(href);
  if (!safe) return document.createTextNode(label);
  return el('a', {
    href: safe,
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
    class: 'msg-link',
    text: label,
  });
};

const mentionNode = (raw, context) => {
  const username = raw.slice(1).replace(/[._-]+$/, '');
  const isMe = context.currentUsername && username.toLowerCase() === context.currentUsername.toLowerCase();
  return el('span', {
    class: isMe ? 'mention mention-self' : 'mention',
    text: raw,
    dataset: { username },
  });
};

const renderInline = (text, context, depth = 0) => {
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  // Guard against pathological nesting.
  if (depth > 4) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const groups = match.groups;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    lastIndex = match.index + match[0].length;

    if (groups.code) {
      fragment.appendChild(el('code', { class: 'msg-code', text: groups.code.slice(1, -1) }));
    } else if (groups.bold || groups.boldAlt) {
      const inner = (groups.bold || groups.boldAlt).slice(2, -2);
      fragment.appendChild(el('strong', {}, [renderInline(inner, context, depth + 1)]));
    } else if (groups.italic || groups.italicAlt) {
      const inner = (groups.italic || groups.italicAlt).slice(1, -1);
      fragment.appendChild(el('em', {}, [renderInline(inner, context, depth + 1)]));
    } else if (groups.strike) {
      fragment.appendChild(el('del', {}, [renderInline(groups.strike.slice(2, -2), context, depth + 1)]));
    } else if (groups.link) {
      const parsed = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(groups.link);
      fragment.appendChild(parsed ? linkNode(parsed[2], parsed[1]) : document.createTextNode(groups.link));
    } else if (groups.url) {
      fragment.appendChild(linkNode(groups.url, groups.url));
    } else if (groups.mention) {
      fragment.appendChild(mentionNode(groups.mention, context));
    }
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return fragment;
};

/** Splits the body into fenced code blocks and everything else. */
const splitBlocks = (body) => {
  const blocks = [];
  const pattern = /```([a-z0-9+#-]*)\n?([\s\S]*?)```/gi;
  let lastIndex = 0;

  for (const match of body.matchAll(pattern)) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', value: body.slice(lastIndex, match.index) });
    }
    blocks.push({ type: 'code', language: match[1] || '', value: match[2].replace(/\n$/, '') });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) blocks.push({ type: 'text', value: body.slice(lastIndex) });
  return blocks;
};

const renderTextBlock = (value, context) => {
  const fragment = document.createDocumentFragment();
  const lines = value.split('\n');

  lines.forEach((line, index) => {
    const quoted = /^&gt;\s?|^>\s?/.test(line);
    if (quoted) {
      fragment.appendChild(
        el('span', { class: 'msg-quote' }, [renderInline(line.replace(/^>\s?/, ''), context)])
      );
    } else {
      fragment.appendChild(renderInline(line, context));
    }
    if (index < lines.length - 1) fragment.appendChild(el('br'));
  });

  return fragment;
};

/** Renders a message body into a fragment of safe nodes. */
export const renderMarkdown = (body, context = {}) => {
  const fragment = document.createDocumentFragment();
  const text = String(body ?? '');

  for (const block of splitBlocks(text)) {
    if (block.type === 'code') {
      fragment.appendChild(
        el('pre', { class: 'msg-pre' }, [
          el('code', { text: block.value, dataset: { language: block.language } }),
        ])
      );
    } else if (block.value.trim().length > 0 || fragment.childNodes.length > 0) {
      fragment.appendChild(renderTextBlock(block.value, context));
    }
  }

  return fragment;
};

/**
 * Search results arrive with hits wrapped in control characters rather than
 * markup, so highlighting stays a matter of splitting a string.
 */
export const renderSearchSnippet = (snippet) => {
  const fragment = document.createDocumentFragment();
  const pattern = /([\s\S]*?)/g;
  let lastIndex = 0;

  for (const match of String(snippet).matchAll(pattern)) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(snippet.slice(lastIndex, match.index)));
    }
    fragment.appendChild(el('mark', { text: match[1] }));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < snippet.length) {
    fragment.appendChild(document.createTextNode(snippet.slice(lastIndex)));
  }
  return fragment;
};

/** Plain-text preview used in sidebars and notifications. */
export const toPlainText = (body) =>
  String(body ?? '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
