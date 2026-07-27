import { api } from './api.js';
import { avatarFor, clear, el, $ } from './dom.js';
import { icon } from './icons.js';
import { chatSocket } from './socket.js';
import { drafts } from './drafts.js';
import { state, findRoom, historyFor, recomputeUnread, roomTitle, subscribe } from './state.js';
import {
  closeModal,
  confirmDialog,
  isModalOpen,
  modal,
  noticeToast,
  popover,
  theme,
  toast,
} from './ui.js';
import { renderAuth } from './views/auth.js';
import { createSidebar } from './views/sidebar.js';
import { createMessageList } from './views/messages.js';
import { createComposer } from './views/composer.js';
import { createRightPanel } from './views/panels.js';
import {
  openAdminPanel,
  openBrowseRooms,
  openCreateRoom,
  openMemberActions,
  openNewDm,
  openProfile,
  openRoomSettings,
  openShortcuts,
} from './views/modals.js';
import {
  isTabFocused,
  notifyMention,
  requestNotificationPermission,
  updateTitle,
} from './notifications.js';
import { toPlainText } from './markdown.js';
import { EMOJI_GROUPS } from './emoji.js';

const root = document.getElementById('app');
const TYPING_TIMEOUT_MS = 6000;

let sidebar;
let messageList;
let composer;
let rightPanel;
let headerRefs = {};

// --- helpers ------------------------------------------------------------

const inviteCodeFromUrl = () => {
  const match = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  return match ? match[1] : null;
};

const setConnectionState = (status) => {
  const banner = $('#connection-banner');
  if (!banner) return;

  const messages = {
    online: '',
    connecting: 'Reconnecting…',
    offline: 'You are offline. Messages you send will be delivered when the connection returns.',
    ended: 'Your session ended. Reload to sign in again.',
  };

  const text = messages[status] || '';
  banner.textContent = state.pendingCount > 0 && status !== 'online'
    ? `${text} (${state.pendingCount} queued)`
    : text;
  banner.hidden = !text;
  banner.dataset.status = status;
};

// --- data loading -------------------------------------------------------

const loadRooms = async () => {
  const { rooms } = await api.rooms.mine();
  state.rooms = rooms;
  recomputeUnread();
  sidebar.render();
  updateTitle(state.unreadTotal);
};

const loadHistory = async (roomId, { before = null } = {}) => {
  const entry = historyFor(roomId);
  const { messages, hasMore } = await api.rooms.messages(roomId, { before });

  if (before) {
    entry.messages = [...messages, ...entry.messages];
  } else {
    entry.messages = messages;
  }
  entry.hasMore = hasMore;
  entry.loaded = true;

  if (before) messageList.refresh({ keepScroll: true });
  return entry;
};

const markRoomRead = (roomId) => {
  const entry = state.history.get(roomId);
  const last = entry?.messages[entry.messages.length - 1];
  if (!last) return;

  const room = findRoom(roomId);
  if (room) {
    room.unreadCount = 0;
    room.mentionCount = 0;
    recomputeUnread();
    sidebar.render();
    updateTitle(state.unreadTotal);
  }

  chatSocket.emitFireAndForget('room:read', { roomId, messageId: last.id });
};

const selectRoom = async (roomId, { focusComposer = true } = {}) => {
  if (!roomId) return;

  state.activeRoomId = roomId;
  rightPanel.close();
  state.reply = null;
  state.editing = null;

  const room = findRoom(roomId);
  renderHeader(room);
  document.body.classList.remove('drawer-open');

  try {
    const detail = await api.rooms.get(roomId);
    state.room = detail.room;
    state.membership = detail.membership;
    state.members = detail.members;
    state.pinned = detail.pinned;
    state.canModerate = detail.canModerate;
    renderHeader(detail.room);

    const entry = historyFor(roomId);
    if (!entry.loaded) await loadHistory(roomId);

    messageList.setRoom(roomId);
    composer.setRoom(roomId);
    composer.setDisabled(false);
    markRoomRead(roomId);

    chatSocket.emitFireAndForget('room:join', { roomId });
    if (focusComposer) composer.focus();
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

// --- header -------------------------------------------------------------

const renderHeader = (room) => {
  if (!room || !headerRefs.title) return;

  const isDm = room.kind === 'dm';
  clear(headerRefs.title).append(
    isDm
      ? avatarFor(room.partner, { size: 'xs' })
      : el('span', { class: 'room-glyph' }, [
          icon(room.visibility === 'private' ? 'lock' : 'hash', { size: 16 }),
        ]),
    el('span', { text: roomTitle(room) })
  );

  headerRefs.topic.textContent = isDm
    ? room.partner?.statusMessage || `@${room.partner?.username || ''}`
    : room.topic || 'No topic set';

  headerRefs.settings.hidden = isDm || !state.canModerate;
  headerRefs.leave.hidden = isDm || room.slug === 'general';

  // Counts sit beside the icon rather than replacing it.
  const withCount = (button, iconName, count, label) => {
    clear(button).append(icon(iconName));
    if (count > 0) button.appendChild(el('span', { class: 'icon-count', text: String(count) }));
    button.title = label;
    button.setAttribute('aria-label', label);
  };

  withCount(headerRefs.pinned, 'pin', state.pinned.length, `Pinned messages (${state.pinned.length})`);
  withCount(headerRefs.members, 'users', state.members.length, `Members (${state.members.length})`);
};

const buildHeader = () => {
  const title = el('h1', { class: 'room-title', id: 'room-title' });
  const topic = el('p', { class: 'room-topic' });

  const iconButton = (label, iconName, onClick) =>
    el(
      'button',
      { class: 'icon-button', type: 'button', title: label, 'aria-label': label, onClick },
      [icon(iconName)]
    );

  const members = iconButton('Show members', 'users', () => togglePanel('members'));
  const pinned = iconButton('Show pinned messages', 'pin', () => togglePanel('pinned'));
  const search = iconButton('Search this room', 'search', () => togglePanel('search'));
  const settings = iconButton('Room settings', 'settings', () =>
    openRoomSettings({
      room: state.room,
      onUpdated: async (updated) => {
        state.room = updated;
        await loadRooms();
        renderHeader(updated);
      },
      onDeleted: async () => {
        closeModal();
        state.history.delete(state.activeRoomId);
        await loadRooms();
        const next = state.rooms[0];
        if (next) selectRoom(next.id);
      },
    })
  );
  const leave = iconButton('Leave this room', 'door-exit', async () => {
    try {
      await api.rooms.leave(state.activeRoomId);
      state.history.delete(state.activeRoomId);
      await loadRooms();
      const next = state.rooms[0];
      if (next) selectRoom(next.id);
      toast('You left the room.');
    } catch (error) {
      toast(error.message, { level: 'error' });
    }
  });

  headerRefs = { title, topic, members, pinned, search, settings, leave };

  return el('header', { class: 'room-header' }, [
    el(
      'button',
      {
        class: 'icon-button drawer-toggle',
        type: 'button',
        'aria-label': 'Show rooms',
        title: 'Show rooms',
        onClick: () => document.body.classList.toggle('drawer-open'),
      },
      [icon('menu')]
    ),
    el('div', { class: 'room-heading' }, [title, topic]),
    el('div', { class: 'room-header-actions' }, [search, pinned, members, settings, leave]),
  ]);
};

const togglePanel = (which) => {
  if (rightPanel.mode === which) {
    rightPanel.close();
    return;
  }
  if (which === 'members') rightPanel.showMembers();
  else if (which === 'pinned') rightPanel.showPinned();
  else if (which === 'search') rightPanel.showSearch();
};

// --- message actions ----------------------------------------------------

const sendMessage = ({ body, attachmentId, parentId }) => {
  const roomId = state.activeRoomId;
  const clientId = `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

  const payload = { roomId, body, attachmentId, parentId, clientId };

  if (!chatSocket.connected) {
    // Show it immediately as pending; the outbox delivers it on reconnect.
    const entry = historyFor(roomId);
    entry.messages.push({
      id: clientId,
      roomId,
      kind: 'user',
      body,
      createdAt: new Date().toISOString(),
      author: state.user,
      reactions: [],
      replyCount: 0,
      mentionedUserIds: [],
      pending: true,
    });
    messageList.onNewMessage({ author: state.user });
  }

  state.reply = null;
  composer.renderContext();
  chatSocket.queueMessage(payload);
};

const toggleReaction = async (messageId, emoji) => {
  try {
    await chatSocket.request('reaction:toggle', { messageId, emoji });
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

const pickReaction = (messageId, anchor) => {
  const grid = el('div', { class: 'emoji-grid' });
  for (const group of EMOJI_GROUPS) {
    grid.appendChild(el('h3', { class: 'emoji-group-title', text: group.name }));
    const row = el('div', { class: 'emoji-row' });
    for (const [emoji] of group.emoji) {
      row.appendChild(
        el('button', {
          class: 'emoji-button',
          type: 'button',
          'aria-label': `React with ${emoji}`,
          text: emoji,
          onClick: () => {
            toggleReaction(messageId, emoji);
            handle.close();
          },
        })
      );
    }
    grid.appendChild(row);
  }
  const handle = popover(anchor, el('div', { class: 'emoji-picker' }, [grid]));
};

const startReply = (message) => {
  state.editing = null;
  state.reply = {
    id: message.id,
    authorName: message.author?.displayName || message.authorLabel || 'Unknown',
    excerpt: toPlainText(message.body).slice(0, 90) || 'Attachment',
  };
  composer.endEdit();
  composer.renderContext();
  composer.focus();
};

const startEdit = (message) => {
  state.reply = null;
  state.editing = { id: message.id };
  composer.startEdit(message);
};

const cancelEdit = () => {
  state.editing = null;
  composer.endEdit();
  composer.focus();
};

const saveEdit = async (messageId, body) => {
  try {
    await chatSocket.request('message:edit', { messageId, body });
    state.editing = null;
    composer.endEdit();
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

const deleteMessage = async (message) => {
  const confirmed = await confirmDialog({
    title: 'Delete this message?',
    message: 'It will be replaced with a "message deleted" placeholder for everyone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await chatSocket.request('message:delete', { messageId: message.id });
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

const togglePin = async (message) => {
  try {
    await chatSocket.request('message:pin', { messageId: message.id });
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

const openThread = async (messageId) => {
  try {
    const thread = await api.messages.thread(messageId);
    rightPanel.showThread(thread);
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

const jumpToMessage = async (messageId) => {
  if (messageList.highlight(messageId)) return;

  // The target is older than what is loaded, so pull pages until it appears.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = historyFor(state.activeRoomId);
    if (!entry.hasMore) break;
    await loadHistory(state.activeRoomId, { before: entry.messages[0]?.id });
    if (messageList.highlight(messageId)) return;
  }
  toast('That message is too far back to jump to.', { level: 'warn' });
};

const openDmWith = async (userId) => {
  try {
    const { room } = await api.dms.open(userId);
    await loadRooms();
    selectRoom(room.id);
  } catch (error) {
    toast(error.message, { level: 'error' });
  }
};

// --- typing indicator ---------------------------------------------------

const typingFor = (roomId) => {
  if (!state.typing.has(roomId)) state.typing.set(roomId, new Map());
  return state.typing.get(roomId);
};

const refreshTyping = () => {
  // Runs on a timer, so it has to tolerate being called before a room is open.
  if (!messageList || !state.activeRoomId) return;

  const map = typingFor(state.activeRoomId);
  const now = Date.now();
  for (const [userId, entry] of map) {
    if (entry.expiresAt < now) map.delete(userId);
  }
  messageList.setTyping([...map.values()].map((entry) => entry.user));
};

// --- socket wiring ------------------------------------------------------

const applyIncomingMessage = (message) => {
  const entry = historyFor(message.roomId);

  if (entry.loaded) {
    const pendingIndex = entry.messages.findIndex(
      (existing) => existing.pending && existing.body === message.body
    );
    if (pendingIndex >= 0) entry.messages.splice(pendingIndex, 1);

    if (!entry.messages.some((existing) => existing.id === message.id)) {
      entry.messages.push(message);
    }
  }

  const room = findRoom(message.roomId);
  if (room) {
    room.lastMessage = {
      id: message.id,
      body: message.body,
      username: message.author?.username || message.authorLabel,
      kind: message.kind,
      createdAt: message.createdAt,
    };

    const isActive = message.roomId === state.activeRoomId && isTabFocused();
    const isMine = message.author?.id === state.user?.id;
    if (!isActive && !isMine) {
      room.unreadCount = (room.unreadCount || 0) + 1;
      if ((message.mentionedUserIds || []).includes(state.user?.id)) {
        room.mentionCount = (room.mentionCount || 0) + 1;
      }
    }

    // Bump recency in the sidebar.
    state.rooms = [room, ...state.rooms.filter((other) => other.id !== room.id)];
    recomputeUnread();
    sidebar.render();
    updateTitle(state.unreadTotal);
  }

  typingFor(message.roomId).delete(message.author?.id);

  if (message.roomId === state.activeRoomId) {
    messageList.onNewMessage(message);
    refreshTyping();
    if (isTabFocused() && messageList.isNearBottom()) markRoomRead(message.roomId);
  }
};

const wireSocket = () => {
  chatSocket.on('ready', (payload) => {
    state.user = payload.user;
    state.commands = payload.commands;
    state.rooms = payload.rooms;
    recomputeUnread();
    sidebar.render();
    updateTitle(state.unreadTotal);
  });

  chatSocket.on('message:new', ({ message }) => applyIncomingMessage(message));

  chatSocket.on('message:updated', ({ message }) => {
    const entry = state.history.get(message.roomId);
    if (entry) {
      const index = entry.messages.findIndex((existing) => existing.id === message.id);
      if (index >= 0) entry.messages[index] = message;
    }
    if (message.roomId === state.activeRoomId) messageList.refresh({ keepScroll: true });
  });

  chatSocket.on('message:deleted', ({ id, roomId }) => {
    const entry = state.history.get(roomId);
    if (entry) {
      const index = entry.messages.findIndex((existing) => existing.id === id);
      if (index >= 0) entry.messages[index] = { ...entry.messages[index], isDeleted: true, body: '' };
    }
    if (roomId === state.activeRoomId) messageList.refresh({ keepScroll: true });
  });

  chatSocket.on('message:reactions', ({ messageId, roomId, reactions }) => {
    const entry = state.history.get(roomId);
    if (entry) {
      const message = entry.messages.find((existing) => existing.id === messageId);
      if (message) message.reactions = reactions;
    }
    if (roomId === state.activeRoomId) messageList.refresh({ keepScroll: true });
  });

  chatSocket.on('room:pinned', ({ roomId, pinned }) => {
    if (roomId !== state.activeRoomId) return;
    state.pinned = pinned;
    renderHeader(state.room);
    if (rightPanel.mode === 'pinned') rightPanel.showPinned();
  });

  chatSocket.on('room:members-changed', ({ roomId, members }) => {
    if (roomId !== state.activeRoomId) return;
    state.members = members;
    renderHeader(state.room);
    if (rightPanel.mode === 'members') rightPanel.showMembers();
  });

  chatSocket.on('room:updated', ({ room }) => {
    if (room.id === state.activeRoomId) {
      state.room = room;
      renderHeader(room);
    }
    loadRooms();
  });

  chatSocket.on('room:deleted', ({ roomId, name }) => {
    state.history.delete(roomId);
    if (roomId === state.activeRoomId) {
      toast(`“${name}” was deleted.`, { level: 'warn' });
      const next = state.rooms.find((room) => room.id !== roomId);
      if (next) selectRoom(next.id);
    }
    loadRooms();
  });

  chatSocket.on('rooms:refresh', () => loadRooms());

  chatSocket.on('presence:update', ({ user }) => {
    if (user.id === state.user?.id) {
      state.user = user;
      sidebar.render();
    }

    const member = state.members.find((existing) => existing.id === user.id);
    if (member) {
      Object.assign(member, user);
      if (rightPanel.mode === 'members') rightPanel.showMembers();
    }

    for (const room of state.rooms) {
      if (room.kind === 'dm' && room.partner?.id === user.id) Object.assign(room.partner, user);
    }
    sidebar.render();
  });

  chatSocket.on('typing', ({ roomId, user, isTyping }) => {
    const map = typingFor(roomId);
    if (isTyping) map.set(user.id, { user, expiresAt: Date.now() + TYPING_TIMEOUT_MS });
    else map.delete(user.id);
    if (roomId === state.activeRoomId) refreshTyping();
  });

  chatSocket.on('notice', ({ text, level }) => noticeToast(text, level));

  chatSocket.on('mention', ({ message, room }) => {
    notifyMention({
      message,
      room,
      onClick: () => selectRoom(room.id),
    });
  });

  chatSocket.on('room:kicked', ({ roomId, reason }) => {
    toast(reason || 'You were removed from a room.', { level: 'warn', timeout: 9000 });
    state.history.delete(roomId);
    loadRooms().then(() => {
      if (roomId === state.activeRoomId) {
        const next = state.rooms[0];
        if (next) selectRoom(next.id);
      }
    });
  });

  chatSocket.on('session:ended', ({ reason }) => {
    toast(reason || 'Your session ended.', { level: 'error', timeout: 0 });
    composer.setDisabled(true, 'You can no longer post.');
  });

  chatSocket.on('server:shutdown', () => {
    toast('The server is restarting. Reconnecting shortly…', { level: 'warn' });
  });

  subscribe('connection', setConnectionState);
  subscribe('pending', () => setConnectionState(state.connection));
};

// --- keyboard shortcuts -------------------------------------------------

const openQuickSwitcher = () => {
  const input = el('input', {
    class: 'field-input',
    type: 'search',
    placeholder: 'Jump to a room or person…',
    'data-autofocus': '',
  });
  const list = el('div', { class: 'switcher-list' });
  let matches = [];
  let index = 0;

  const paint = () => {
    const query = input.value.trim().toLowerCase();
    matches = state.rooms
      .filter((room) => roomTitle(room).toLowerCase().includes(query))
      .slice(0, 8);
    index = Math.min(index, Math.max(matches.length - 1, 0));

    clear(list);
    matches.forEach((room, position) => {
      list.appendChild(
        el('button', {
          class: `switcher-item${position === index ? ' is-selected' : ''}`,
          type: 'button',
          onClick: () => {
            closeModal();
            selectRoom(room.id);
          },
        }, [
          el('span', { class: 'room-glyph' }, [icon(room.kind === 'dm' ? 'user' : 'hash', { size: 15 })]),
          el('span', { text: roomTitle(room) }),
          room.unreadCount ? el('span', { class: 'badge', text: String(room.unreadCount) }) : null,
        ])
      );
    });
  };

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      index = (index + 1) % Math.max(matches.length, 1);
      paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      index = (index - 1 + matches.length) % Math.max(matches.length, 1);
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const room = matches[index];
      if (room) {
        closeModal();
        selectRoom(room.id);
      }
    }
  });

  modal({ title: 'Jump to', width: 'sm', body: el('div', { class: 'switcher' }, [input, list]) });
  paint();
};

const cycleRoom = (direction) => {
  const index = state.rooms.findIndex((room) => room.id === state.activeRoomId);
  if (index < 0) return;
  const next = state.rooms[(index + direction + state.rooms.length) % state.rooms.length];
  if (next) selectRoom(next.id);
};

const wireShortcuts = () => {
  document.addEventListener('keydown', (event) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openQuickSwitcher();
      return;
    }

    if (meta && event.key.toLowerCase() === 'f' && state.activeRoomId) {
      event.preventDefault();
      togglePanel('search');
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      cycleRoom(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Escape' && !isModalOpen()) {
      if (rightPanel.mode) {
        rightPanel.close();
        composer.focus();
      }
      return;
    }

    if (inField || isModalOpen()) return;

    if (event.key === '?') {
      event.preventDefault();
      openShortcuts();
      return;
    }

    // Typing anywhere jumps into the composer, like a native chat client.
    if (event.key.length === 1 && !meta && !event.altKey) {
      composer.focus();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (isTabFocused() && state.activeRoomId) markRoomRead(state.activeRoomId);
  });
};

// --- boot ---------------------------------------------------------------

const mountApp = async () => {
  sidebar = createSidebar({
    onSelectRoom: (roomId) => selectRoom(roomId),
    onBrowse: () => openBrowseRooms({ onJoined: async (roomId) => { await loadRooms(); selectRoom(roomId); } }),
    onCreateRoom: () => openCreateRoom({ onCreated: async (room) => { await loadRooms(); selectRoom(room.id); } }),
    onNewDm: () => openNewDm({ onOpened: async (roomId) => { await loadRooms(); selectRoom(roomId); } }),
    onProfile: () => openProfile({ onUpdated: (user) => { state.user = user; sidebar.render(); } }),
    onAdmin: () => openAdminPanel(),
    onLogout: async () => {
      await api.auth.logout();
      chatSocket.disconnect();
      window.location.reload();
    },
    onToggleTheme: () => {
      const next = theme.cycle();
      sidebar.renderTheme();
      toast(`Theme: ${next}`, { timeout: 1500 });
    },
    onPresenceChange: async (presence) => {
      try {
        await chatSocket.request('presence:set', { presence });
      } catch (error) {
        toast(error.message, { level: 'error' });
      }
    },
  });

  messageList = createMessageList({
    onReply: startReply,
    onEdit: startEdit,
    onDelete: deleteMessage,
    onToggleReaction: toggleReaction,
    onPickReaction: pickReaction,
    onTogglePin: togglePin,
    onOpenThread: openThread,
    onLoadMore: async (roomId) => {
      const entry = historyFor(roomId);
      await loadHistory(roomId, { before: entry.messages[0]?.id });
    },
    onMentionClick: async (username) => {
      try {
        const { users } = await api.users.search(username);
        const match = users.find((user) => user.username.toLowerCase() === username.toLowerCase());
        if (match && match.id !== state.user?.id) openDmWith(match.id);
      } catch {
        // Not worth interrupting the user over a failed profile lookup.
      }
    },
  });

  composer = createComposer({
    onSend: sendMessage,
    onTyping: (isTyping) =>
      chatSocket.emitFireAndForget('typing', { roomId: state.activeRoomId, isTyping }),
    onCancelReply: () => {
      state.reply = null;
      composer.renderContext();
      composer.focus();
    },
    onCancelEdit: cancelEdit,
    onSaveEdit: saveEdit,
  });

  rightPanel = createRightPanel({
    onClose: () => rightPanel.close(),
    onOpenDm: openDmWith,
    onJumpToMessage: jumpToMessage,
    onSearch: (query) => api.rooms.search(state.activeRoomId, query),
    onReplyInThread: (parent) => {
      startReply(parent);
      rightPanel.close();
    },
    onModerateMember: (member, anchor) =>
      openMemberActions(member, anchor, {
        roomId: state.activeRoomId,
        onDone: async () => {
          const { members } = await api.rooms.members(state.activeRoomId);
          state.members = members;
          rightPanel.showMembers();
        },
      }),
  });

  clear(root).appendChild(
    el('div', { class: 'app-shell' }, [
      el('div', { class: 'drawer-scrim', onClick: () => document.body.classList.remove('drawer-open') }),
      sidebar.root,
      el('main', { class: 'main-pane', 'aria-labelledby': 'room-title' }, [
        buildHeader(),
        el('div', { class: 'connection-banner', id: 'connection-banner', role: 'status', hidden: true }),
        messageList.root,
        composer.root,
      ]),
      rightPanel.root,
    ])
  );

  wireSocket();
  wireShortcuts();
  chatSocket.connect();

  // Expire stale "is typing" entries once the UI exists to show them.
  setInterval(refreshTyping, 2000);

  subscribe('outbox:failed', ({ error }) => toast(`Message not sent: ${error}`, { level: 'error' }));

  await loadRooms();

  const inviteCode = inviteCodeFromUrl();
  if (inviteCode) {
    try {
      const { room } = await api.invites.accept(inviteCode);
      window.history.replaceState({}, '', '/');
      await loadRooms();
      await selectRoom(room.id);
      toast(`You joined ${room.name}.`, { level: 'success' });
    } catch (error) {
      window.history.replaceState({}, '', '/');
      toast(error.message, { level: 'error' });
      if (state.rooms[0]) selectRoom(state.rooms[0].id);
    }
  } else if (state.rooms[0]) {
    selectRoom(state.rooms[0].id, { focusComposer: false });
  }

  requestNotificationPermission();
};

const boot = async () => {
  theme.init();

  try {
    const { user } = await api.auth.me();
    if (user) {
      state.user = user;
      await mountApp();
      return;
    }
  } catch {
    // Fall through to the sign-in screen.
  }

  renderAuth(root, {
    inviteCode: inviteCodeFromUrl(),
    onSignedIn: async (user) => {
      state.user = user;
      await mountApp();
    },
  });
};

boot();
