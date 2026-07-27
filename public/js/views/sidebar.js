import { avatarFor, clear, el } from '../dom.js';
import { drafts } from '../drafts.js';
import { state, roomTitle } from '../state.js';
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

  const icon =
    room.kind === 'dm'
      ? avatarFor(room.partner, { size: 'xs' })
      : el('span', {
          class: 'room-glyph',
          'aria-hidden': 'true',
          text: room.visibility === 'private' ? '🔒' : '#',
        });

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
        icon,
        el('span', { class: 'room-item-body' }, [
          el('span', { class: 'room-item-title' }, [
            el('span', { class: 'room-item-name', text: title }),
            hasDraft ? el('span', { class: 'draft-dot', title: 'Unsent draft', text: '✎' }) : null,
          ]),
          el('span', { class: 'room-item-preview', text: preview }),
        ]),
        unreadBadge(room),
      ]
    ),
  ]);
};

const sectionHeader = (label, action) =>
  el('div', { class: 'sidebar-section-head' }, [
    el('h2', { class: 'sidebar-section-title', text: label }),
    action,
  ]);

export const createSidebar = ({ onSelectRoom, onBrowse, onCreateRoom, onNewDm, onProfile, onAdmin, onLogout, onToggleTheme, onPresenceChange }) => {
  const roomList = el('ul', { class: 'room-list', role: 'tablist', 'aria-label': 'Rooms' });
  const dmList = el('ul', { class: 'room-list', role: 'tablist', 'aria-label': 'Direct messages' });
  const dmSection = el('div', { class: 'sidebar-section' });

  const userName = el('span', { class: 'me-name' });
  const userStatus = el('span', { class: 'me-status' });
  const avatarSlot = el('span', { class: 'me-avatar' });

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

  const adminButton = el('button', {
    class: 'icon-button',
    type: 'button',
    title: 'Admin panel',
    'aria-label': 'Open admin panel',
    text: '🛡',
    hidden: true,
    onClick: onAdmin,
  });

  const root = el('aside', { class: 'sidebar', 'aria-label': 'Rooms and account' }, [
    el('div', { class: 'sidebar-head' }, [
      el('span', { class: 'brand' }, [
        el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: '💬' }),
        el('span', { text: 'Chat Room' }),
      ]),
      el('button', {
        class: 'icon-button',
        type: 'button',
        title: 'Toggle theme',
        'aria-label': 'Toggle colour theme',
        text: '◐',
        onClick: onToggleTheme,
      }),
    ]),

    el('div', { class: 'sidebar-scroll' }, [
      el('div', { class: 'sidebar-section' }, [
        sectionHeader(
          'Rooms',
          el('span', { class: 'sidebar-actions' }, [
            el('button', {
              class: 'icon-button',
              type: 'button',
              title: 'Browse rooms',
              'aria-label': 'Browse public rooms',
              text: '🔍',
              onClick: onBrowse,
            }),
            el('button', {
              class: 'icon-button',
              type: 'button',
              title: 'Create a room',
              'aria-label': 'Create a room',
              text: '+',
              onClick: onCreateRoom,
            }),
          ])
        ),
        roomList,
      ]),
      dmSection,
    ]),

    el('div', { class: 'sidebar-foot' }, [
      el(
        'button',
        {
          class: 'me-card',
          type: 'button',
          'aria-label': 'Open your profile',
          onClick: onProfile,
        },
        [avatarSlot, el('span', { class: 'me-text' }, [userName, userStatus])]
      ),
      el('div', { class: 'me-actions' }, [
        presenceSelect,
        adminButton,
        el('button', {
          class: 'icon-button',
          type: 'button',
          title: 'Sign out',
          'aria-label': 'Sign out',
          text: '⏻',
          onClick: onLogout,
        }),
      ]),
    ]),
  ]);

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
      sectionHeader(
        'Direct messages',
        el('button', {
          class: 'icon-button',
          type: 'button',
          title: 'Start a direct message',
          'aria-label': 'Start a direct message',
          text: '+',
          onClick: onNewDm,
        })
      )
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
  };

  return { root, render };
};
