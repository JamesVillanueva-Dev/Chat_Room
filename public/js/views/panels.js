import { avatarFor, clear, el, formatDay, formatTime } from '../dom.js';
import { icon } from '../icons.js';
import { renderMarkdown, renderSearchSnippet } from '../markdown.js';
import { state } from '../state.js';

const PRESENCE_LABEL = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' };

export const createRightPanel = ({
  onClose,
  onOpenDm,
  onJumpToMessage,
  onSearch,
  onReplyInThread,
  onSetRoomRole,
  onModerateMember,
}) => {
  const title = el('h2', { class: 'panel-title', id: 'panel-title' });
  const body = el('div', { class: 'panel-body' });

  const root = el('aside', {
    class: 'right-panel',
    'aria-labelledby': 'panel-title',
    hidden: true,
  }, [
    el('header', { class: 'panel-head' }, [
      title,
      el(
        'button',
        { class: 'icon-button', type: 'button', 'aria-label': 'Close panel', title: 'Close panel', onClick: onClose },
        [icon('x')]
      ),
    ]),
    body,
  ]);

  let mode = null;

  const open = (nextMode, label) => {
    mode = nextMode;
    title.textContent = label;
    root.hidden = false;
    root.dataset.mode = nextMode;
  };

  const close = () => {
    mode = null;
    root.hidden = true;
    clear(body);
  };

  // --- members ----------------------------------------------------------

  const memberRow = (member) => {
    const isMe = member.id === state.user?.id;
    const canManage = state.canModerate && !isMe;

    const actions = el('div', { class: 'member-actions' });
    if (!isMe) {
      actions.appendChild(
        el(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            title: `Message ${member.username}`,
            'aria-label': `Send a direct message to ${member.username}`,
            onClick: () => onOpenDm(member.id),
          },
          [icon('message-square', { size: 15 })]
        )
      );
    }
    if (canManage) {
      actions.appendChild(
        el(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            title: 'Moderate',
            'aria-label': `Moderation options for ${member.username}`,
            onClick: (event) => onModerateMember(member, event.currentTarget),
          },
          [icon('settings', { size: 15 })]
        )
      );
    }

    return el('li', { class: 'member-row' }, [
      el('span', { class: `presence-dot presence-${member.presence}`, title: PRESENCE_LABEL[member.presence] }),
      avatarFor(member, { size: 'sm' }),
      el('span', { class: 'member-text' }, [
        el('span', { class: 'member-name' }, [
          el('span', { text: member.displayName || member.username }),
          member.roomRole !== 'member'
            ? el('span', { class: 'tag', text: member.roomRole })
            : null,
          member.role === 'admin' ? el('span', { class: 'tag tag-admin', text: 'admin' }) : null,
        ]),
        el('span', {
          class: 'member-status',
          text: member.statusMessage || PRESENCE_LABEL[member.presence],
        }),
      ]),
      actions,
    ]);
  };

  const showMembers = () => {
    open('members', `Members · ${state.members.length}`);
    clear(body);

    const online = state.members.filter((member) => member.presence !== 'offline');
    const offline = state.members.filter((member) => member.presence === 'offline');

    const section = (label, members) => {
      if (members.length === 0) return null;
      return el('div', { class: 'panel-section' }, [
        el('h3', { class: 'panel-section-title', text: `${label} — ${members.length}` }),
        el('ul', { class: 'member-list' }, members.map(memberRow)),
      ]);
    };

    body.appendChild(
      el('div', {}, [section('Online', online), section('Offline', offline)].filter(Boolean))
    );
  };

  // --- pinned -----------------------------------------------------------

  const showPinned = () => {
    open('pinned', `Pinned · ${state.pinned.length}`);
    clear(body);

    if (state.pinned.length === 0) {
      body.appendChild(
        el('p', { class: 'panel-empty', text: 'Nothing pinned yet. Moderators can pin important messages.' })
      );
      return;
    }

    body.appendChild(
      el(
        'ul',
        { class: 'pinned-list' },
        state.pinned.map((message) =>
          el('li', { class: 'pinned-item' }, [
            el('button', {
              class: 'pinned-button',
              type: 'button',
              onClick: () => onJumpToMessage(message.id),
            }, [
              el('span', { class: 'pinned-author', text: message.author?.displayName || message.authorLabel || 'Unknown' }),
              el('span', { class: 'pinned-text' }, [
                renderMarkdown(message.body, { currentUsername: state.user?.username }),
              ]),
              el('time', { class: 'pinned-time', datetime: message.createdAt, text: formatDay(message.createdAt) }),
            ]),
          ])
        )
      )
    );
  };

  // --- thread -----------------------------------------------------------

  const threadMessage = (message, { isParent = false } = {}) =>
    el('article', { class: `thread-message${isParent ? ' is-parent' : ''}` }, [
      avatarFor(message.author, { size: 'sm' }),
      el('div', { class: 'thread-message-main' }, [
        el('div', { class: 'thread-message-head' }, [
          el('span', {
            class: 'message-author',
            text: message.author?.displayName || message.authorLabel || 'Unknown',
          }),
          el('time', { class: 'message-time', datetime: message.createdAt, text: formatTime(message.createdAt) }),
        ]),
        message.isDeleted
          ? el('p', { class: 'message-deleted', text: 'This message was deleted.' })
          : el('div', { class: 'message-text' }, [
              renderMarkdown(message.body, { currentUsername: state.user?.username }),
            ]),
      ]),
    ]);

  const showThread = ({ parent, replies }) => {
    open('thread', 'Thread');
    clear(body);

    body.appendChild(
      el('div', { class: 'thread' }, [
        threadMessage(parent, { isParent: true }),
        el('div', { class: 'thread-divider' }, [
          el('span', { text: `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` }),
        ]),
        el('div', { class: 'thread-replies' }, replies.map((reply) => threadMessage(reply))),
        el('button', {
          class: 'button button-ghost button-block',
          type: 'button',
          text: 'Reply in thread',
          onClick: () => onReplyInThread(parent),
        }),
      ])
    );
  };

  // --- search -----------------------------------------------------------

  const showSearch = () => {
    open('search', 'Search this room');
    clear(body);

    const input = el('input', {
      class: 'field-input',
      type: 'search',
      placeholder: 'Find messages…',
      'aria-label': 'Search messages in this room',
      'data-autofocus': '',
    });
    const results = el('div', { class: 'search-results' });

    let timer = null;
    const run = async () => {
      const query = input.value.trim();
      clear(results);
      if (query.length < 2) {
        results.appendChild(el('p', { class: 'panel-empty', text: 'Type at least two characters.' }));
        return;
      }

      results.appendChild(el('p', { class: 'panel-empty', text: 'Searching…' }));
      const found = await onSearch(query);
      clear(results);

      if (found.results.length === 0) {
        results.appendChild(el('p', { class: 'panel-empty', text: `No messages match “${query}”.` }));
        return;
      }

      results.appendChild(
        el('ul', { class: 'search-list' }, found.results.map((hit) =>
          el('li', {}, [
            el('button', {
              class: 'search-hit',
              type: 'button',
              onClick: () => onJumpToMessage(hit.id),
            }, [
              el('span', { class: 'search-hit-head' }, [
                el('span', { class: 'search-hit-author', text: hit.author.displayName || hit.author.username }),
                el('time', { class: 'search-hit-time', datetime: hit.createdAt, text: formatDay(hit.createdAt) }),
              ]),
              el('span', { class: 'search-hit-snippet' }, [renderSearchSnippet(hit.snippet)]),
            ]),
          ])
        ))
      );

      if (found.hasMore) {
        results.appendChild(el('p', { class: 'panel-empty', text: 'Refine your search to see more.' }));
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });

    body.appendChild(el('div', { class: 'search-panel' }, [input, results]));
    input.focus();
  };

  return {
    root,
    close,
    showMembers,
    showPinned,
    showThread,
    showSearch,
    get mode() {
      return mode;
    },
    refresh: () => {
      if (mode === 'members') showMembers();
      else if (mode === 'pinned') showPinned();
    },
  };
};
