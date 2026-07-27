/**
 * A single mutable store plus a tiny pub/sub. Views subscribe to the channels
 * they care about and re-render when the store announces a change, which keeps
 * every screen reading from one source of truth.
 */
const listeners = new Map();

export const state = {
  user: null,
  rooms: [],
  activeRoomId: null,
  room: null,
  membership: null,
  canModerate: false,
  members: [],
  pinned: [],
  // roomId -> { messages, hasMore, loaded }
  history: new Map(),
  // roomId -> Map(userId -> { user, expiresAt })
  typing: new Map(),
  thread: null,
  search: null,
  connection: 'connecting',
  pendingCount: 0,
  reply: null,
  editing: null,
  unreadTotal: 0,
  commands: [],
};

export const subscribe = (channel, handler) => {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(handler);
  return () => listeners.get(channel).delete(handler);
};

export const emit = (channel, payload) => {
  for (const handler of listeners.get(channel) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`listener for "${channel}" failed`, error);
    }
  }
};

export const historyFor = (roomId) => {
  if (!state.history.has(roomId)) {
    state.history.set(roomId, { messages: [], hasMore: true, loaded: false });
  }
  return state.history.get(roomId);
};

export const findRoom = (roomId) => state.rooms.find((room) => room.id === roomId) || null;

/** DM rooms are titled by whoever you are talking to. */
export const roomTitle = (room) => {
  if (!room) return '';
  if (room.kind === 'dm') return room.partner?.displayName || room.partner?.username || 'Direct message';
  return room.name;
};

export const recomputeUnread = () => {
  state.unreadTotal = state.rooms.reduce((total, room) => total + (room.unreadCount || 0), 0);
  emit('unread');
};
