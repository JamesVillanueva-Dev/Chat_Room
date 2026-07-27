import { avatarFor, clear, el } from '../dom.js';
import { drafts } from '../drafts.js';
import { icon, themeIcon } from '../icons.js';
import { state, roomTitle } from '../state.js';
import { theme } from '../ui.js';
import { toPlainText } from '../markdown.js';

const PRESENCE_LABEL = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' };

const unreadBadge = (room) => {
  if (!room.unreadCount) return null;
  const isMention = room.mentionCount > 0;
  return el('span', {
    class: `badge${isMention ? ' badge-mention' : ''}`,
    text: room.unreadCount > 99 ? '99+' : String(room.unreadCount),
    'aria-label': isMention
      ? `${room.unreadCount} unread, ${room.mentionCount} mentioning you`
      : `${room.unreadCount} unread`,
  });
};

const roomButton = (room, { onSelect, draftRooms }) => {
  const isActive = room.id === state.activeRoomId;
  const title = roomTitle(room);
  const hasDraft = draftRooms.has(room.id) && !isActive;

  const glyph =
    room.kind === 'dm'
      ? avatarFor(room.partner, { size: 'xs' })
      : el('span', { class: 'room-glyph' }, [
          icon(room.visibility === 'private' ? 'lock' : 'hash', { size: 15 }),
        ]);

  const preview = room.lastMessage
    ? `${room.lastMessage.username ? `${room.lastMessage.username}: ` : ''}${toPlainText(room.lastMessage.body)}`
    : 'No messages yet';

  return el('li', { role: 'none' }, [
    el(
      'button',
      {
        class: `room-item${isActive ? ' is-active' : ''}${room.unreadCount ? ' is-unread' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(isActive),
        'aria-current': isActive ? 'true' : null,
        dataset: { roomId: String(room.id) },
        onClick: () => onSelect(room.id),
      },
      [
        glyph,
        el('span', { class: 'room-item-body' }, [
          el('span', { class: 'room-item-title' }, [
            el('span', { class: 'room-item-name', text: title }),
            hasDraft
              ? el('span', { class: 'draft-dot', title: 'Unsent draft' }, [icon('pencil', { size: 12 })])
              : null,
          ]),
          el('span', { class: 'room-item-preview', text: preview }),
        ]),
        unreadBadge(room),
      ]
    ),
  ]);
};

const iconButton = (name, label, onClick, extraClass = '') =>
  el(
    'button',
    {
      class: `icon-button${extraClass ? ` ${extraClass}` : ''}`,
      type: 'button',
      title: label,
      'aria-label': label,
      onClick,
    },
    [icon(name)]
  );

const sectionHeader = (label, action) =>
  el('div', { class: 'sidebar-section-head' }, [
    el('h2', { class: 'sidebar-section-title', text: label }),
    action,
  ]);

export const createSidebar = ({
  onSelectRoom,
  onBrowse,
  onCreateRoom,
  onNewDm,
  onProfile,
  onAdmin,
  onLogout,
  onToggleTheme,
  onPresenceChange,
}) => {
  const roomList = el('ul', { class: 'room-list', role: 'tablist', 'aria-label': 'Rooms' });
  const dmList = el('ul', { class: 'room-list', role: 'tablist', 'aria-label': 'Direct messages' });
  const dmSection = el('div', { class: 'sidebar-section' });

  const userName = el('span', { class: 'me-name' });
  const userStatus = el('span', { class: 'me-status' });
  const avatarSlot = el('span', { class: 'me-avatar' });

  const themeButton = el('button', {
    class: 'icon-button',
    type: 'button',
    title: 'Change theme',
    'aria-label': 'Change colour theme',
    onClick: onToggleTheme,
  });

  const presenceSelect = el(
    'select',
    {
      class: 'presence-select',
      'aria-label': 'Set your availability',
      onChange: (event) => onPresenceChange(event.target.value),
    },
    Object.entries(PRESENCE_LABEL)
      .filter(([value]) => value !== 'offline')
      .map(([value, label]) => el('option', { value, text: label }))
  );

  const adminButton = iconButton('shield', 'Open admin panel', onAdmin);
  adminButton.hidden = true;

  const root = el('aside', { class: 'sidebar', 'aria-label': 'Rooms and account' }, [
    el('div', { class: 'sidebar-head' }, [
      el('span', { class: 'brand' }, [
        el('span', { class: 'brand-mark' }, [icon('message-circle', { size: 20 })]),
        el('span', { text: 'Chat Room' }),
      ]),
      themeButton,
    ]),

    el('div', { class: 'sidebar-scroll' }, [
      el('div', { class: 'sidebar-section' }, [
        sectionHeader(
          'Rooms',
          el('span', { class: 'sidebar-actions' }, [
            iconButton('search', 'Browse public rooms', onBrowse),
            iconButton('plus', 'Create a room', onCreateRoom),
          ])
        ),
        roomList,
      ]),
      dmSection,
    ]),

    el('div', { class: 'sidebar-foot' }, [
      el(
        'button',
        { class: 'me-card', type: 'button', 'aria-label': 'Open your profile', onClick: onProfile },
        [avatarSlot, el('span', { class: 'me-text' }, [userName, userStatus])]
      ),
      el('div', { class: 'me-actions' }, [
        presenceSelect,
        adminButton,
        iconButton('log-out', 'Sign out', onLogout),
      ]),
    ]),
  ]);

  const renderTheme = () => {
    clear(themeButton).appendChild(icon(themeIcon(theme.get())));
  };

  const render = () => {
    const draftRooms = new Set(drafts.roomsWithDrafts());
    const rooms = state.rooms.filter((room) => room.kind !== 'dm');
    const dms = state.rooms.filter((room) => room.kind === 'dm');

    clear(roomList);
    for (const room of rooms) {
      roomList.appendChild(roomButton(room, { onSelect: onSelectRoom, draftRooms }));
    }

    clear(dmSection);
    dmSection.appendChild(
      sectionHeader('Direct messages', iconButton('plus', 'Start a direct message', onNewDm))
    );

    clear(dmList);
    if (dms.length === 0) {
      dmSection.appendChild(el('p', { class: 'sidebar-empty', text: 'No conversations yet.' }));
    } else {
      for (const room of dms) {
        dmList.appendChild(roomButton(room, { onSelect: onSelectRoom, draftRooms }));
      }
      dmSection.appendChild(dmList);
    }

    if (state.user) {
      clear(avatarSlot).appendChild(avatarFor(state.user, { size: 'sm' }));
      userName.textContent = state.user.displayName || state.user.username;
      userStatus.textContent = state.user.statusMessage || PRESENCE_LABEL[state.user.presence] || '';
      presenceSelect.value = state.user.presence === 'offline' ? 'online' : state.user.presence;
      adminButton.hidden = state.user.role !== 'admin';
    }

    renderTheme();
  };

  return { root, render, renderTheme };
};
