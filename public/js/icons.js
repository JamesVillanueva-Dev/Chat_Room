/**
 * Inline SVG icon set.
 *
 * Icons are drawn rather than typed so they render identically on every
 * platform — emoji glyphs vary by OS, pick up the system's colour font, and
 * read as informal. Everything here is a stroked 24x24 outline using
 * `currentColor`, so icons inherit text colour and work in both themes.
 *
 * Emoji still appear in the product, but only where they are content: the
 * reaction picker and the reactions on a message.
 */

const NS = 'http://www.w3.org/2000/svg';

// Each icon is a list of [tag, attributes] shapes.
const ICONS = {
  'message-circle': [
    ['path', { d: 'M21 11.5a8.5 8.5 0 0 1-11.9 7.8L3.5 21l1.7-5.1A8.5 8.5 0 1 1 21 11.5Z' }],
  ],
  'message-square': [['path', { d: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.6-3.6' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  hash: [['path', { d: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18' }]],
  lock: [
    ['rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }],
    ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
  ],
  users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  user: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' }],
  ],
  pin: [
    ['path', { d: 'M12 17v5' }],
    [
      'path',
      {
        d: 'M9 10.76V6a3 3 0 0 1 6 0v4.76a2 2 0 0 0 .59 1.42l1.7 1.7A1 1 0 0 1 16.59 16H7.41a1 1 0 0 1-.71-1.71l1.71-1.71A2 2 0 0 0 9 10.76Z',
      },
    ],
  ],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    [
      'path',
      {
        d: 'M19.1 14.5a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .33-1.77 1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.33H9a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.77V9a1.6 1.6 0 0 0 1.47.97H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.46.97Z',
      },
    ],
  ],
  shield: [['path', { d: 'M12 22s8-4 8-10V5.5L12 2 4 5.5V12c0 6 8 10 8 10Z' }]],
  'log-out': [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['path', { d: 'm16 17 5-5-5-5M21 12H9' }],
  ],
  'door-exit': [
    ['path', { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8' }],
    ['path', { d: 'm18 16 4-4-4-4M22 12H10' }],
  ],
  menu: [['path', { d: 'M4 6h16M4 12h16M4 18h16' }]],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    [
      'path',
      { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' },
    ],
  ],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' }]],
  monitor: [
    ['rect', { x: 2, y: 4, width: 20, height: 13, rx: 2 }],
    ['path', { d: 'M8 21h8M12 17v4' }],
  ],
  paperclip: [
    [
      'path',
      {
        d: 'M21.4 11.05 12.9 19.5a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78',
      },
    ],
  ],
  smile: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M8.5 14.5a4.5 4.5 0 0 0 7 0' }],
    ['path', { d: 'M9 9.5h.01M15 9.5h.01' }],
  ],
  reply: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h10a6 6 0 0 1 6 6v5' }]],
  pencil: [
    ['path', { d: 'M17.5 3.5a2.12 2.12 0 0 1 3 3L7 20l-4 1 1-4Z' }],
    ['path', { d: 'm15 6 3 3' }],
  ],
  trash: [
    ['path', { d: 'M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6' }],
    ['path', { d: 'M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M10 11v6M14 11v6' }],
  ],
  bot: [
    ['rect', { x: 3, y: 8, width: 18, height: 12, rx: 3 }],
    ['path', { d: 'M12 8V5' }],
    ['circle', { cx: 12, cy: 3.5, r: 1.5 }],
    ['path', { d: 'M9 14h.01M15 14h.01' }],
  ],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11.5v5M12 8h.01' }]],
  file: [
    ['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z' }],
    ['path', { d: 'M14 3v5h5' }],
  ],
  image: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
    ['circle', { cx: 8.5, cy: 9.5, r: 1.8 }],
    ['path', { d: 'm21 16-4.5-4.5L7 21' }],
  ],
  download: [['path', { d: 'M12 3v12M7 11l5 5 5-5' }], ['path', { d: 'M4 20h16' }]],
  send: [['path', { d: 'M22 2 11 13' }], ['path', { d: 'M22 2 15 22l-4-9-9-4Z' }]],
  'arrow-down': [['path', { d: 'M12 5v13M18 12l-6 6-6-6' }]],
  'corner-down-right': [['path', { d: 'M4 4v7a4 4 0 0 0 4 4h12' }], ['path', { d: 'm16 11 4 4-4 4' }]],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' }],
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  bell: [
    ['path', { d: 'M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7' }],
    ['path', { d: 'M13.7 21a2 2 0 0 1-3.4 0' }],
  ],
};

/** Builds an icon element. Icons are decorative; the control carries the label. */
export const icon = (name, { size = 17, className = '' } = {}) => {
  const shapes = ICONS[name];
  if (!shapes) throw new Error(`Unknown icon: ${name}`);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);

  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      shape.setAttribute(key, String(value));
    }
    svg.appendChild(shape);
  }

  return svg;
};

/** The icon for the current theme preference, used by the theme toggle. */
export const themeIcon = (preference) =>
  ({ light: 'sun', dark: 'moon', system: 'monitor' })[preference] || 'monitor';

export const hasIcon = (name) => Object.hasOwn(ICONS, name);
export const iconNames = () => Object.keys(ICONS);
