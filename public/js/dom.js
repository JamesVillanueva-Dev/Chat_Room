/**
 * Small DOM helpers. Everything in this app builds elements through these so
 * text always lands via textContent and never through innerHTML.
 */

export const el = (tag, attributes = {}, children = []) => {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
};

export const append = (parent, children) => {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return parent;
};

export const clear = (node) => {
  node.replaceChildren();
  return node;
};

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export const show = (node, visible = true) => {
  node.hidden = !visible;
  return node;
};

/** Formats a byte count for attachment labels. */
export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

export const formatTime = (iso) => timeFormatter.format(new Date(iso));

export const formatDay = (iso) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return dayFormatter.format(date);
};

export const formatRelative = (iso) => {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

/** Initials shown when a user has no uploaded avatar. */
export const initialsFor = (name) => {
  const parts = String(name || '').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const avatarFor = (user, { size = 'md' } = {}) => {
  const name = user?.displayName || user?.username || '?';
  if (user?.avatarUrl) {
    return el('img', {
      class: `avatar avatar-${size}`,
      src: user.avatarUrl,
      alt: '',
      loading: 'lazy',
    });
  }
  return el('span', {
    class: `avatar avatar-${size} avatar-initials`,
    style: { backgroundColor: user?.avatarColor || '#5b8def' },
    text: initialsFor(name),
    'aria-hidden': 'true',
  });
};

export const debounce = (fn, delay = 200) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};
