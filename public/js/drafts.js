const KEY = 'chatroom.drafts';

/**
 * Per-room composer drafts kept in localStorage, so switching rooms or
 * reloading the page does not throw away a half-written message.
 */
const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const write = (drafts) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // Ignore quota errors; a lost draft is better than a broken composer.
  }
};

export const drafts = {
  get(roomId) {
    return read()[String(roomId)] || '';
  },

  set(roomId, text) {
    const all = read();
    const key = String(roomId);
    if (text && text.trim()) all[key] = text;
    else delete all[key];
    write(all);
  },

  clear(roomId) {
    drafts.set(roomId, '');
  },

  roomsWithDrafts() {
    return Object.keys(read()).map(Number);
  },
};
