import { avatarFor, clear, el, formatBytes, formatDay, formatTime } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import { QUICK_REACTIONS } from '../emoji.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 140;

const sameAuthor = (a, b) => {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'user') return a.author?.id === b.author?.id;
  return a.authorLabel === b.authorLabel;
};

const isGrouped = (previous, message) =>
  sameAuthor(previous, message) &&
  !message.parent &&
  new Date(message.createdAt) - new Date(previous.createdAt) < GROUP_WINDOW_MS;

const authorNameOf = (message) => {
  if (message.kind === 'user') return message.author?.displayName || message.author?.username || 'Unknown';
  return message.authorLabel || (message.kind === 'bot' ? 'Bot' : 'System');
};

export const createMessageList = ({
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onPickReaction,
  onTogglePin,
  onOpenThread,
  onLoadMore,
  onMentionClick,
}) => {
  const list = el('div', {
    class: 'messages',
    id: 'message-log',
    role: 'log',
    'aria-live': 'polite',
    'aria-relevant': 'additions text',
    'aria-label': 'Messages',
    tabindex: '0',
  });

  const topSentinel = el('div', { class: 'load-more-sentinel' });
  const typingRow = el('div', { class: 'typing-row', 'aria-live': 'polite', hidden: true });

  const jumpButton = el(
    'button',
    {
      class: 'jump-latest',
      type: 'button',
      hidden: true,
      onClick: () => scrollToBottom({ smooth: true }),
    },
    [icon('arrow-down', { size: 15 }), el('span', { text: 'Jump to latest' })]
  );

  const scroller = el('div', { class: 'message-scroll' }, [topSentinel, list, typingRow]);
  const root = el('div', { class: 'message-pane' }, [scroller, jumpButton]);

  const nodesById = new Map();
  let loadingMore = false;
  let currentRoomId = null;

  const isNearBottom = () =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;

  const scrollToBottom = ({ smooth = false } = {}) => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    jumpButton.hidden = true;
  };

  // --- message rendering ------------------------------------------------

  const reactionBar = (message) => {
    const bar = el('div', { class: 'reactions' });
    const mine = state.user?.id;

    for (const reaction of message.reactions || []) {
      const reactedByMe = reaction.userIds.includes(mine);
      bar.appendChild(
        el('button', {
          class: `reaction${reactedByMe ? ' is-mine' : ''}`,
          type: 'button',
          'aria-pressed': String(reactedByMe),
          'aria-label': `${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`,
          title: `${reaction.count} ${reaction.count === 1 ? 'person' : 'people'}`,
          onClick: () => onToggleReaction(message.id, reaction.emoji),
        }, [
          el('span', { class: 'reaction-emoji', text: reaction.emoji }),
          el('span', { class: 'reaction-count', text: String(reaction.count) }),
        ])
      );
    }

    if (bar.childNodes.length > 0) {
      bar.appendChild(
        el(
          'button',
          {
            class: 'reaction reaction-add',
            type: 'button',
            'aria-label': 'Add a reaction',
            title: 'Add a reaction',
            onClick: (event) => onPickReaction(message.id, event.currentTarget),
          },
          [icon('smile', { size: 15 })]
        )
      );
    }
    return bar;
  };

  const attachmentNode = (attachment) => {
    if (!attachment) return null;

    if (attachment.kind === 'image') {
      return el('a', {
        class: 'attachment-image',
        href: attachment.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [
        el('img', { src: attachment.url, alt: attachment.name, loading: 'lazy' }),
      ]);
    }

    return el('a', {
      class: 'attachment-file',
      href: attachment.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      download: attachment.name,
    }, [
      el('span', { class: 'attachment-icon' }, [icon('file', { size: 18 })]),
      el('span', { class: 'attachment-meta' }, [
        el('span', { class: 'attachment-name', text: attachment.name }),
        el('span', { class: 'attachment-size', text: formatBytes(attachment.size) }),
      ]),
      el('span', { class: 'attachment-download' }, [icon('download', { size: 16 })]),
    ]);
  };

  const linkPreviewNode = (preview) => {
    if (!preview) return null;
    let host = '';
    try {
      host = new URL(preview.url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }

    return el('a', {
      class: 'link-preview',
      href: preview.url,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }, [
      preview.imageUrl
        ? el('img', { class: 'link-preview-image', src: preview.imageUrl, alt: '', loading: 'lazy' })
        : null,
      el('span', { class: 'link-preview-body' }, [
        el('span', { class: 'link-preview-site', text: preview.siteName || host }),
        preview.title ? el('span', { class: 'link-preview-title', text: preview.title }) : null,
        preview.description
          ? el('span', { class: 'link-preview-description', text: preview.description })
          : null,
      ]),
    ]);
  };

  const parentQuote = (message) =>
    el('button', {
      class: 'reply-quote',
      type: 'button',
      'aria-label': `Replying to ${message.parent.author}. Open thread.`,
      onClick: () => onOpenThread(message.parent.id),
    }, [
      icon('corner-down-right', { size: 13 }),
      el('span', { class: 'reply-quote-author', text: message.parent.author }),
      el('span', { class: 'reply-quote-text', text: message.parent.excerpt }),
    ]);

  const actionBar = (message) => {
    const canEdit = message.kind === 'user' && message.author?.id === state.user?.id && !message.isDeleted;
    const canDelete =
      !message.isDeleted &&
      (message.author?.id === state.user?.id || state.canModerate);
    const canPin = state.canModerate && !message.isDeleted;

    const actions = el('div', { class: 'message-actions', role: 'group', 'aria-label': 'Message actions' });

    const add = (label, iconName, handler, extraClass = '') =>
      actions.appendChild(
        el(
          'button',
          {
            class: `icon-button message-action${extraClass ? ` ${extraClass}` : ''}`,
            type: 'button',
            title: label,
            'aria-label': label,
            onClick: handler,
          },
          [icon(iconName, { size: 15 })]
        )
      );

    if (!message.isDeleted) {
      // These stay as emoji: they are the reaction being applied, not chrome.
      for (const emoji of QUICK_REACTIONS.slice(0, 3)) {
        actions.appendChild(
          el('button', {
            class: 'icon-button message-action quick-react',
            type: 'button',
            title: `React ${emoji}`,
            'aria-label': `React with ${emoji}`,
            text: emoji,
            onClick: () => onToggleReaction(message.id, emoji),
          })
        );
      }
      add('Add a reaction', 'smile', (event) => onPickReaction(message.id, event.currentTarget));
      add('Reply in thread', 'reply', () => onReply(message));
    }
    if (canEdit) add('Edit message', 'pencil', () => onEdit(message));
    if (canPin) add(message.pinnedAt ? 'Unpin message' : 'Pin message', 'pin', () => onTogglePin(message));
    if (canDelete) add('Delete message', 'trash', () => onDelete(message), 'is-danger');

    return actions;
  };

  const buildMessage = (message, previous) => {
    const grouped = isGrouped(previous, message);
    const mentionsMe = (message.mentionedUserIds || []).includes(state.user?.id);

    const classes = [
      'message',
      grouped ? 'is-grouped' : '',
      message.kind !== 'user' ? `is-${message.kind}` : '',
      mentionsMe ? 'is-mention' : '',
      message.pinnedAt ? 'is-pinned' : '',
      message.pending ? 'is-pending' : '',
      message.failed ? 'is-failed' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const body = el('div', { class: 'message-body' });

    if (message.parent) body.appendChild(parentQuote(message));

    if (message.isDeleted) {
      body.appendChild(el('p', { class: 'message-deleted', text: 'This message was deleted.' }));
    } else {
      const text = el('div', { class: 'message-text' });
      text.appendChild(renderMarkdown(message.body, { currentUsername: state.user?.username }));
      if (message.editedAt) {
        text.appendChild(
          el('span', {
            class: 'edited-marker',
            title: `Edited ${formatTime(message.editedAt)}`,
            text: ' (edited)',
          })
        );
      }
      body.appendChild(text);

      const attachment = attachmentNode(message.attachment);
      if (attachment) body.appendChild(attachment);

      const preview = linkPreviewNode(message.linkPreview);
      if (preview) body.appendChild(preview);
    }

    body.appendChild(reactionBar(message));

    if (message.replyCount > 0) {
      body.appendChild(
        el('button', {
          class: 'thread-link',
          type: 'button',
          onClick: () => onOpenThread(message.id),
          text: `${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}`,
        })
      );
    }

    if (message.failed) {
      body.appendChild(el('p', { class: 'message-error', text: `Not sent: ${message.failed}` }));
    }

    const gutter = el('div', { class: 'message-gutter' }, [
      grouped
        ? el('span', { class: 'message-time-hover', text: formatTime(message.createdAt) })
        : message.kind === 'user'
          ? avatarFor(message.author, { size: 'md' })
          : el('span', { class: 'avatar avatar-md avatar-bot' }, [
              icon(message.kind === 'bot' ? 'bot' : 'info', { size: 19 }),
            ]),
    ]);

    const header = grouped
      ? null
      : el('div', { class: 'message-head' }, [
          el('span', { class: 'message-author', text: authorNameOf(message) }),
          message.kind === 'bot' ? el('span', { class: 'tag', text: 'bot' }) : null,
          message.author?.role === 'admin' ? el('span', { class: 'tag tag-admin', text: 'admin' }) : null,
          el('time', {
            class: 'message-time',
            datetime: message.createdAt,
            text: formatTime(message.createdAt),
          }),
          message.pinnedAt
            ? el('span', { class: 'tag tag-pin' }, [icon('pin', { size: 11 }), el('span', { text: 'pinned' })])
            : null,
        ]);

    const article = el('article', {
      class: classes,
      dataset: { messageId: String(message.id) },
      tabindex: '-1',
    }, [
      gutter,
      el('div', { class: 'message-main' }, [header, body].filter(Boolean)),
      message.pending ? null : actionBar(message),
    ]);

    return article;
  };

  // --- list management --------------------------------------------------

  const currentMessages = () => {
    const entry = state.history.get(currentRoomId);
    return entry ? entry.messages : [];
  };

  const renderAll = () => {
    clear(list);
    nodesById.clear();

    const messages = currentMessages();
    let previous = null;
    let lastDay = null;

    for (const message of messages) {
      const day = formatDay(message.createdAt);
      if (day !== lastDay) {
        list.appendChild(
          el('div', { class: 'day-divider', role: 'separator' }, [el('span', { text: day })])
        );
        lastDay = day;
        previous = null;
      }

      const node = buildMessage(message, previous);
      nodesById.set(message.id, node);
      list.appendChild(node);
      previous = message;
    }
  };

  const setRoom = (roomId) => {
    currentRoomId = roomId;
    renderAll();
    requestAnimationFrame(() => scrollToBottom());
  };

  const refresh = ({ keepScroll = false } = {}) => {
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    const atBottom = isNearBottom();

    renderAll();

    if (keepScroll) {
      // Preserve the reading position when older messages are prepended.
      scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    } else if (atBottom) {
      scrollToBottom();
    }
  };

  const onNewMessage = (message) => {
    const atBottom = isNearBottom();
    refresh({ keepScroll: false });
    if (atBottom || message.author?.id === state.user?.id) scrollToBottom();
    else jumpButton.hidden = false;
  };

  const highlight = (messageId) => {
    const node = nodesById.get(messageId);
    if (!node) return false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('is-highlighted');
    node.focus({ preventScroll: true });
    setTimeout(() => node.classList.remove('is-highlighted'), 2000);
    return true;
  };

  const setTyping = (users) => {
    if (users.length === 0) {
      typingRow.hidden = true;
      clear(typingRow);
      return;
    }

    const names = users.map((user) => user.displayName || user.username);
    const label =
      names.length === 1
        ? `${names[0]} is typing`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing`
          : `${names.length} people are typing`;

    clear(typingRow).appendChild(
      el('span', { class: 'typing-indicator' }, [
        el('span', { class: 'typing-dots', 'aria-hidden': 'true' }, [
          el('i'), el('i'), el('i'),
        ]),
        el('span', { text: label }),
      ])
    );
    typingRow.hidden = false;
  };

  // Infinite scroll upward: load older history as the sentinel comes into view.
  const observer = new IntersectionObserver(
    async (entries) => {
      if (!entries[0].isIntersecting || loadingMore || !currentRoomId) return;
      const entry = state.history.get(currentRoomId);
      if (!entry || !entry.hasMore || !entry.loaded) return;

      loadingMore = true;
      list.prepend(el('div', { class: 'loading-older', text: 'Loading earlier messages…' }));
      try {
        await onLoadMore(currentRoomId);
      } finally {
        loadingMore = false;
      }
    },
    { root: scroller, rootMargin: '200px 0px 0px 0px' }
  );
  observer.observe(topSentinel);

  scroller.addEventListener('scroll', () => {
    if (isNearBottom()) jumpButton.hidden = true;
  });

  list.addEventListener('click', (event) => {
    const mention = event.target.closest('.mention');
    if (mention?.dataset.username) onMentionClick(mention.dataset.username);
  });

  return {
    root,
    scroller,
    setRoom,
    refresh,
    onNewMessage,
    scrollToBottom,
    isNearBottom,
    highlight,
    setTyping,
  };
};
