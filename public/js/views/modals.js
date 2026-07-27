import { api } from '../api.js';
import { avatarFor, clear, el, formatRelative } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { closeModal, confirmDialog, field, modal, popover, toast } from '../ui.js';
import { notificationSettings } from '../notifications.js';

// --- create room --------------------------------------------------------

export const openCreateRoom = ({ onCreated }) => {
  const nameInput = el('input', { class: 'field-input', maxlength: '48', 'data-autofocus': '' });
  const topicInput = el('input', { class: 'field-input', maxlength: '160' });
  const passwordInput = el('input', { class: 'field-input', type: 'password', autocomplete: 'new-password' });
  const visibilitySelect = el('select', { class: 'field-input' }, [
    el('option', { value: 'public', text: 'Public — anyone can find and join' }),
    el('option', { value: 'private', text: 'Private — invite link only' }),
  ]);
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const submit = async () => {
    error.hidden = true;
    try {
      const result = await api.rooms.create({
        name: nameInput.value,
        topic: topicInput.value,
        visibility: visibilitySelect.value,
        password: passwordInput.value || undefined,
      });
      closeModal();
      onCreated(result.room);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };

  modal({
    title: 'Create a room',
    body: el('div', { class: 'form-stack' }, [
      field({ label: 'Name', input: nameInput }),
      field({ label: 'Topic', input: topicInput, hint: 'Optional — shown in the room header.' }),
      field({ label: 'Visibility', input: visibilitySelect }),
      field({
        label: 'Password',
        input: passwordInput,
        hint: 'Optional. Public rooms with a password ask for it before joining.',
      }),
      error,
    ]),
    actions: [
      el('button', { class: 'button button-ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { class: 'button button-primary', type: 'button', text: 'Create room', onClick: submit }),
    ],
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
};

// --- browse rooms -------------------------------------------------------

export const openBrowseRooms = ({ onJoined }) => {
  const search = el('input', {
    class: 'field-input',
    type: 'search',
    placeholder: 'Search rooms…',
    'data-autofocus': '',
  });
  const list = el('div', { class: 'browse-list' });

  const load = async () => {
    clear(list).appendChild(el('p', { class: 'panel-empty', text: 'Loading…' }));
    try {
      const { rooms } = await api.rooms.browse(search.value.trim());
      clear(list);

      if (rooms.length === 0) {
        list.appendChild(el('p', { class: 'panel-empty', text: 'No rooms match that search.' }));
        return;
      }

      for (const room of rooms) {
        const joinButton = el('button', {
          class: room.isMember ? 'button button-ghost' : 'button button-primary',
          type: 'button',
          text: room.isMember ? 'Open' : 'Join',
          onClick: async () => {
            if (!room.isMember && room.hasPassword) {
              // Opening a dialog replaces this one, so ask for the password in
              // its own step rather than nesting.
              openJoinWithPassword(room, onJoined);
              return;
            }

            try {
              if (!room.isMember) await api.rooms.join(room.id);
              closeModal();
              onJoined(room.id);
            } catch (error) {
              toast(error.message, { level: 'error' });
            }
          },
        });

        list.appendChild(
          el('div', { class: 'browse-item' }, [
            el('div', { class: 'browse-item-main' }, [
              el('span', { class: 'browse-name' }, [
                el('span', { class: 'room-glyph' }, [
                  icon(room.visibility === 'private' ? 'lock' : 'hash', { size: 15 }),
                ]),
                el('span', { text: room.name }),
                room.hasPassword
                  ? el('span', { class: 'tag' }, [icon('lock', { size: 11 }), el('span', { text: 'password' })])
                  : null,
              ]),
              room.topic ? el('span', { class: 'browse-topic', text: room.topic }) : null,
              el('span', {
                class: 'browse-meta',
                text: `${room.memberCount} member${room.memberCount === 1 ? '' : 's'} · ${room.messageCount} message${room.messageCount === 1 ? '' : 's'}`,
              }),
            ]),
            joinButton,
          ])
        );
      }
    } catch (error) {
      clear(list).appendChild(el('p', { class: 'panel-empty', text: error.message }));
    }
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  });

  modal({
    title: 'Browse rooms',
    width: 'lg',
    body: el('div', { class: 'browse' }, [search, list]),
  });

  load();
};

export const openJoinWithPassword = (room, onJoined) => {
  const password = el('input', {
    class: 'field-input',
    type: 'password',
    autocomplete: 'off',
    'data-autofocus': '',
  });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const join = async () => {
    error.hidden = true;
    try {
      await api.rooms.join(room.id, password.value);
      closeModal();
      onJoined(room.id);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      password.select();
    }
  };

  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      join();
    }
  });

  modal({
    title: `Join ${room.name}`,
    width: 'sm',
    body: el('div', { class: 'form-stack' }, [
      el('p', { class: 'modal-message', text: 'This room is protected by a password.' }),
      field({ label: 'Room password', input: password }),
      error,
    ]),
    actions: [
      el('button', { class: 'button button-ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { class: 'button button-primary', type: 'button', text: 'Join room', onClick: join }),
    ],
  });
};

// --- start a direct message --------------------------------------------

export const openNewDm = ({ onOpened }) => {
  const search = el('input', {
    class: 'field-input',
    type: 'search',
    placeholder: 'Find someone…',
    'data-autofocus': '',
  });
  const list = el('div', { class: 'browse-list' });

  const load = async () => {
    try {
      const { users } = search.value.trim()
        ? await api.users.search(search.value.trim())
        : await api.users.list();
      clear(list);

      const others = users.filter((user) => user.id !== state.user?.id);
      if (others.length === 0) {
        list.appendChild(el('p', { class: 'panel-empty', text: 'Nobody found.' }));
        return;
      }

      for (const user of others) {
        list.appendChild(
          el('button', {
            class: 'user-row',
            type: 'button',
            onClick: async () => {
              try {
                const { room } = await api.dms.open(user.id);
                closeModal();
                onOpened(room.id);
              } catch (error) {
                toast(error.message, { level: 'error' });
              }
            },
          }, [
            avatarFor(user, { size: 'sm' }),
            el('span', { class: 'user-row-text' }, [
              el('span', { class: 'user-row-name', text: user.displayName || user.username }),
              el('span', { class: 'user-row-sub', text: user.statusMessage || `@${user.username}` }),
            ]),
          ])
        );
      }
    } catch (error) {
      clear(list).appendChild(el('p', { class: 'panel-empty', text: error.message }));
    }
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  });

  modal({ title: 'New direct message', body: el('div', { class: 'browse' }, [search, list]) });
  load();
};

// --- profile ------------------------------------------------------------

export const openProfile = ({ onUpdated }) => {
  const user = state.user;
  const displayName = el('input', { class: 'field-input', value: user.displayName, maxlength: '24' });
  const statusMessage = el('input', { class: 'field-input', value: user.statusMessage, maxlength: '80' });
  const bio = el('textarea', { class: 'field-input', rows: '3', maxlength: '280', text: user.bio });
  const avatarSlot = el('div', { class: 'avatar-editor' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const settings = notificationSettings.get();
  const desktopToggle = el('input', { type: 'checkbox', checked: settings.desktop });
  const soundToggle = el('input', { type: 'checkbox', checked: settings.sound });

  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });

  const paintAvatar = () => {
    clear(avatarSlot).append(
      avatarFor(state.user, { size: 'lg' }),
      el('div', { class: 'avatar-editor-actions' }, [
        el('button', {
          class: 'button button-ghost',
          type: 'button',
          text: 'Upload image',
          onClick: () => fileInput.click(),
        }),
        state.user.avatarUrl
          ? el('button', {
              class: 'button button-ghost',
              type: 'button',
              text: 'Remove',
              onClick: async () => {
                const { user: updated } = await api.users.removeAvatar();
                onUpdated(updated);
                paintAvatar();
              },
            })
          : null,
      ])
    );
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const { user: updated } = await api.users.uploadAvatar(file);
      onUpdated(updated);
      paintAvatar();
    } catch (err) {
      toast(err.message, { level: 'error' });
    }
  });

  const save = async () => {
    error.hidden = true;
    try {
      const { user: updated } = await api.users.updateMe({
        displayName: displayName.value,
        statusMessage: statusMessage.value,
        bio: bio.value,
      });
      notificationSettings.set({ desktop: desktopToggle.checked, sound: soundToggle.checked });
      onUpdated(updated);
      closeModal();
      toast('Profile saved.', { level: 'success' });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };

  const changePassword = async () => {
    closeModal();
    openChangePassword();
  };

  modal({
    title: 'Your profile',
    body: el('div', { class: 'form-stack' }, [
      avatarSlot,
      field({ label: 'Display name', input: displayName }),
      field({ label: 'Status', input: statusMessage, hint: 'Shown next to your name.' }),
      field({ label: 'Bio', input: bio }),
      el('h3', { class: 'form-section-title', text: 'Notifications' }),
      el('label', { class: 'checkbox-field' }, [desktopToggle, el('span', { text: 'Desktop notifications when mentioned' })]),
      el('label', { class: 'checkbox-field' }, [soundToggle, el('span', { text: 'Play a sound on mentions' })]),
      el('button', { class: 'link-button', type: 'button', text: 'Change password…', onClick: changePassword }),
      error,
      fileInput,
    ]),
    actions: [
      el('button', { class: 'button button-ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { class: 'button button-primary', type: 'button', text: 'Save', onClick: save }),
    ],
  });

  paintAvatar();
};

export const openChangePassword = () => {
  const current = el('input', { class: 'field-input', type: 'password', autocomplete: 'current-password', 'data-autofocus': '' });
  const next = el('input', { class: 'field-input', type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const save = async () => {
    error.hidden = true;
    try {
      await api.auth.changePassword(current.value, next.value);
      closeModal();
      toast('Password updated.', { level: 'success' });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };

  modal({
    title: 'Change password',
    width: 'sm',
    body: el('div', { class: 'form-stack' }, [
      field({ label: 'Current password', input: current }),
      field({ label: 'New password', input: next, hint: 'At least 8 characters.' }),
      error,
    ]),
    actions: [
      el('button', { class: 'button button-ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { class: 'button button-primary', type: 'button', text: 'Update', onClick: save }),
    ],
  });
};

// --- room settings ------------------------------------------------------

export const openRoomSettings = ({ room, onUpdated, onDeleted }) => {
  const name = el('input', { class: 'field-input', value: room.name, maxlength: '48', 'data-autofocus': '' });
  const topic = el('input', { class: 'field-input', value: room.topic, maxlength: '160' });
  const visibility = el('select', { class: 'field-input' }, [
    el('option', { value: 'public', text: 'Public', selected: room.visibility === 'public' }),
    el('option', { value: 'private', text: 'Private' }),
  ]);
  const password = el('input', { class: 'field-input', type: 'password', placeholder: room.hasPassword ? '••••••' : 'No password' });
  const inviteBox = el('div', { class: 'invite-box' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const makeInvite = async () => {
    try {
      const { invite } = await api.rooms.createInvite(room.id, {});
      const url = `${window.location.origin}/invite/${invite.code}`;
      clear(inviteBox).append(
        el('input', { class: 'field-input', readonly: true, value: url, onClick: (e) => e.target.select() }),
        el('button', {
          class: 'button button-ghost',
          type: 'button',
          text: 'Copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('Invite link copied.', { level: 'success' });
            } catch {
              toast('Copy failed — select the link and copy it manually.', { level: 'error' });
            }
          },
        })
      );
    } catch (err) {
      toast(err.message, { level: 'error' });
    }
  };

  const save = async () => {
    error.hidden = true;
    try {
      const { room: updated } = await api.rooms.update(room.id, {
        name: name.value,
        topic: topic.value,
        visibility: visibility.value,
        ...(password.value ? { password: password.value } : {}),
      });
      onUpdated(updated);
      closeModal();
      toast('Room updated.', { level: 'success' });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };

  const remove = async () => {
    const confirmed = await confirmDialog({
      title: 'Delete this room?',
      message: `“${room.name}” and all of its messages will be permanently removed.`,
      confirmLabel: 'Delete room',
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api.rooms.remove(room.id);
      onDeleted(room.id);
      toast('Room deleted.', { level: 'success' });
    } catch (err) {
      toast(err.message, { level: 'error' });
    }
  };

  modal({
    title: `Settings — ${room.name}`,
    body: el('div', { class: 'form-stack' }, [
      field({ label: 'Name', input: name }),
      field({ label: 'Topic', input: topic }),
      field({ label: 'Visibility', input: visibility }),
      field({ label: 'Password', input: password, hint: 'Leave blank to keep the current setting.' }),
      el('h3', { class: 'form-section-title', text: 'Invite link' }),
      el('button', { class: 'button button-ghost', type: 'button', text: 'Create invite link', onClick: makeInvite }),
      inviteBox,
      error,
    ]),
    actions: [
      el('button', { class: 'button button-danger', type: 'button', text: 'Delete room', onClick: remove }),
      el('button', { class: 'button button-ghost', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { class: 'button button-primary', type: 'button', text: 'Save', onClick: save }),
    ],
  });
};

// --- moderation popover -------------------------------------------------

export const openMemberActions = (member, anchor, { roomId, onDone }) => {
  const act = async (label, fn) => {
    try {
      await fn();
      toast(`${label} applied to ${member.username}.`, { level: 'success' });
      onDone();
    } catch (error) {
      toast(error.message, { level: 'error' });
    }
    handle.close();
  };

  const buttons = [
    el('button', {
      class: 'menu-item',
      type: 'button',
      text: 'Make moderator',
      onClick: () => act('Moderator role', () => api.rooms.setMemberRole(roomId, member.id, 'moderator')),
    }),
    el('button', {
      class: 'menu-item',
      type: 'button',
      text: 'Make member',
      onClick: () => act('Member role', () => api.rooms.setMemberRole(roomId, member.id, 'member')),
    }),
  ];

  if (state.user?.role === 'admin') {
    buttons.push(
      el('button', {
        class: 'menu-item',
        type: 'button',
        text: 'Mute for 10 minutes',
        onClick: () => act('Mute', () => api.admin.mute(member.id, 10, 'Muted from members panel')),
      }),
      el('button', {
        class: 'menu-item',
        type: 'button',
        text: 'Unmute',
        onClick: () => act('Unmute', () => api.admin.unmute(member.id)),
      }),
      el('button', {
        class: 'menu-item is-danger',
        type: 'button',
        text: 'Ban from server',
        onClick: () => act('Ban', () => api.admin.ban(member.id, 'Banned from members panel')),
      })
    );
  }

  const handle = popover(anchor, el('div', { class: 'menu', role: 'menu' }, buttons));
  return handle;
};

// --- admin panel --------------------------------------------------------

export const openAdminPanel = () => {
  const body = el('div', { class: 'admin-panel' }, [el('p', { class: 'panel-empty', text: 'Loading…' })]);

  const load = async () => {
    try {
      const data = await api.admin.overview();
      clear(body);

      body.appendChild(
        el('div', { class: 'stat-grid' }, [
          statTile('Users', data.stats.users),
          statTile('Rooms', data.stats.rooms),
          statTile('Messages', data.stats.messages),
          statTile('Online now', data.metrics.connections.active),
          statTile('Messages / min', data.metrics.messages.lastMinute),
          statTile('Rate limit hits', data.metrics.activity.rateLimitHits),
        ])
      );

      body.appendChild(el('h3', { class: 'form-section-title', text: 'Users' }));
      body.appendChild(
        el('div', { class: 'admin-table-wrap' }, [
          el('table', { class: 'admin-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'User' }),
                el('th', { text: 'Role' }),
                el('th', { text: 'Presence' }),
                el('th', { text: 'Status' }),
                el('th', { text: 'Actions' }),
              ]),
            ]),
            el('tbody', {}, data.users.map((user) => adminUserRow(user, load))),
          ]),
        ])
      );

      body.appendChild(el('h3', { class: 'form-section-title', text: 'Recent moderation' }));
      body.appendChild(
        data.recentActions.length === 0
          ? el('p', { class: 'panel-empty', text: 'No moderation actions yet.' })
          : el('ul', { class: 'moderation-log' }, data.recentActions.map((entry) =>
              el('li', {}, [
                el('span', { class: 'tag', text: entry.action }),
                el('span', {
                  text: `${entry.actor?.username || 'system'} → ${entry.target?.username || '—'}${entry.room ? ` in ${entry.room.name}` : ''}`,
                }),
                el('span', { class: 'moderation-time', text: formatRelative(entry.createdAt) }),
              ])
            ))
      );
    } catch (error) {
      clear(body).appendChild(el('p', { class: 'panel-empty', text: error.message }));
    }
  };

  modal({ title: 'Admin', width: 'lg', body });
  load();
};

const statTile = (label, value) =>
  el('div', { class: 'stat-tile' }, [
    el('span', { class: 'stat-value', text: String(value) }),
    el('span', { class: 'stat-label', text: label }),
  ]);

const adminUserRow = (user, reload) => {
  const action = async (fn) => {
    try {
      await fn();
      reload();
    } catch (error) {
      toast(error.message, { level: 'error' });
    }
  };

  return el('tr', {}, [
    el('td', {}, [
      el('span', { class: 'admin-user' }, [
        avatarFor(user, { size: 'xs' }),
        el('span', { text: user.displayName || user.username }),
      ]),
    ]),
    el('td', { text: user.role }),
    el('td', { text: user.presence }),
    el('td', { text: user.isBanned ? 'banned' : user.mutedUntil ? 'muted' : 'active' }),
    el('td', {}, [
      el('div', { class: 'admin-actions' }, [
        user.id === state.user?.id
          ? el('span', { class: 'muted-text', text: 'you' })
          : el('button', {
              class: 'link-button',
              type: 'button',
              text: user.role === 'admin' ? 'Demote' : 'Promote',
              onClick: () => action(() => api.admin.setRole(user.id, user.role === 'admin' ? 'user' : 'admin')),
            }),
        user.id === state.user?.id
          ? null
          : el('button', {
              class: 'link-button is-danger',
              type: 'button',
              text: user.isBanned ? 'Unban' : 'Ban',
              onClick: () =>
                action(() => (user.isBanned ? api.admin.unban(user.id) : api.admin.ban(user.id, 'Banned by admin'))),
            }),
      ]),
    ]),
  ]);
};

// --- keyboard shortcuts -------------------------------------------------

export const openShortcuts = () => {
  const rows = [
    ['Ctrl / ⌘ + K', 'Jump to a room'],
    ['Alt + ↑ / ↓', 'Previous / next room'],
    ['Ctrl / ⌘ + F', 'Search this room'],
    ['/', 'Open the command menu'],
    ['Esc', 'Cancel a reply or edit, close panels'],
    ['Enter', 'Send'],
    ['Shift + Enter', 'New line'],
    ['?', 'Show this help'],
  ];

  modal({
    title: 'Keyboard shortcuts',
    body: el('dl', { class: 'shortcut-list' }, rows.flatMap(([keys, description]) => [
      el('dt', {}, [el('kbd', { text: keys })]),
      el('dd', { text: description }),
    ])),
  });
};
