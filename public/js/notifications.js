import { toPlainText } from './markdown.js';

const SETTINGS_KEY = 'chatroom.notifications';
const BASE_TITLE = 'Chat Room';

const readSettings = () => {
  try {
    return { desktop: true, sound: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { desktop: true, sound: true };
  }
};

let settings = readSettings();

export const notificationSettings = {
  get: () => ({ ...settings }),
  set(updates) {
    settings = { ...settings, ...updates };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return { ...settings };
  },
};

export const canNotify = () => 'Notification' in window;

export const notificationPermission = () => (canNotify() ? Notification.permission : 'unsupported');

export const requestNotificationPermission = async () => {
  if (!canNotify() || Notification.permission !== 'default') return notificationPermission();
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

/**
 * A short two-tone chime generated with the Web Audio API — no asset to ship,
 * and nothing to fail to load.
 */
let audioContext = null;

const playChime = () => {
  if (!settings.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = audioContext || new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume();

    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    gain.connect(audioContext.destination);

    [880, 1174].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.12);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.3);
    });
  } catch {
    // Audio is a nicety; never let it break message handling.
  }
};

export const isTabFocused = () => document.visibilityState === 'visible' && document.hasFocus();

/** Reflects unread count in the tab title so a background tab still shows it. */
export const updateTitle = (unreadCount) => {
  document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
};

export const notifyMention = ({ message, room, onClick }) => {
  if (isTabFocused()) return;

  playChime();

  if (!settings.desktop || !canNotify() || Notification.permission !== 'granted') return;

  const author = message.author?.displayName || message.authorLabel || 'Someone';
  const where = room.kind === 'dm' ? 'a direct message' : `#${room.name}`;

  try {
    const notification = new Notification(`${author} mentioned you in ${where}`, {
      body: toPlainText(message.body).slice(0, 160),
      tag: `mention-${message.id}`,
      icon: '/favicon.svg',
    });
    notification.addEventListener('click', () => {
      window.focus();
      onClick?.();
      notification.close();
    });
  } catch {
    // Some browsers throw when constructing notifications outside a gesture.
  }
};

export const notifyDirectMessage = ({ message, room, onClick }) => {
  notifyMention({ message, room, onClick });
};
