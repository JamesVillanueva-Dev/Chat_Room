import { api } from '../api.js';
import { clear, el, formatBytes } from '../dom.js';
import { drafts } from '../drafts.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { EMOJI_GROUPS, searchEmoji } from '../emoji.js';
import { popover, toast } from '../ui.js';

const MAX_ROWS = 10;
const TYPING_INTERVAL_MS = 2500;

export const createComposer = ({ onSend, onTyping, onCancelReply, onCancelEdit, onSaveEdit }) => {
  const textarea = el('textarea', {
    class: 'composer-input',
    id: 'composer-input',
    rows: '1',
    placeholder: 'Write a message…  (/ for commands)',
    'aria-label': 'Message',
    'aria-describedby': 'composer-hint',
    autocomplete: 'off',
  });

  const suggestionList = el('ul', {
    class: 'suggestions',
    id: 'composer-suggestions',
    role: 'listbox',
    'aria-label': 'Suggestions',
    hidden: true,
  });

  const contextBar = el('div', { class: 'composer-context', hidden: true });
  const attachmentBar = el('div', { class: 'composer-attachment', hidden: true });
  const fileInput = el('input', { type: 'file', class: 'visually-hidden', id: 'composer-file' });

  const sendButton = el(
    'button',
    { class: 'button button-primary composer-send', type: 'submit', 'aria-label': 'Send message' },
    [icon('send', { size: 16 }), el('span', { class: 'composer-send-label', text: 'Send' })]
  );

  let roomId = null;
  let suggestions = [];
  let suggestionIndex = 0;
  let suggestionMode = null;
  let pendingAttachment = null;
  let lastTypingSentAt = 0;
  let mentionLookup = null;

  // --- textarea sizing --------------------------------------------------

  const autosize = () => {
    textarea.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  // --- suggestions ------------------------------------------------------

  const hideSuggestions = () => {
    suggestions = [];
    suggestionMode = null;
    suggestionIndex = 0;
    suggestionList.hidden = true;
    clear(suggestionList);
    textarea.removeAttribute('aria-activedescendant');
    textarea.setAttribute('aria-expanded', 'false');
  };

  const renderSuggestions = () => {
    clear(suggestionList);

    suggestions.forEach((item, index) => {
      const selected = index === suggestionIndex;
      suggestionList.appendChild(
        el('li', {
          class: `suggestion${selected ? ' is-selected' : ''}`,
          id: `suggestion-${index}`,
          role: 'option',
          'aria-selected': String(selected),
          onMouseDown: (event) => {
            event.preventDefault();
            applySuggestion(index);
          },
        }, [
          el('span', { class: 'suggestion-label', text: item.label }),
          item.hint ? el('span', { class: 'suggestion-hint', text: item.hint }) : null,
        ])
      );
    });

    suggestionList.hidden = suggestions.length === 0;
    textarea.setAttribute('aria-expanded', String(suggestions.length > 0));
    if (suggestions.length > 0) {
      textarea.setAttribute('aria-activedescendant', `suggestion-${suggestionIndex}`);
    }
  };

  const applySuggestion = (index) => {
    const item = suggestions[index];
    if (!item) return;

    const value = textarea.value;
    const caret = textarea.selectionStart;
    const before = value.slice(0, caret).replace(item.pattern, item.replacement);
    textarea.value = before + value.slice(caret);
    const position = before.length;
    textarea.setSelectionRange(position, position);

    hideSuggestions();
    autosize();
    textarea.focus();
  };

  const updateSuggestions = async () => {
    const upToCaret = textarea.value.slice(0, textarea.selectionStart);

    const commandMatch = /^\/([a-z0-9_-]*)$/i.exec(upToCaret);
    if (commandMatch) {
      const query = commandMatch[1].toLowerCase();
      suggestions = state.commands
        .filter((command) => command.name.startsWith(query))
        .slice(0, 8)
        .map((command) => ({
          label: `/${command.name}`,
          hint: command.summary,
          pattern: /\/[a-z0-9_-]*$/i,
          replacement: `/${command.name} `,
        }));
      suggestionMode = suggestions.length > 0 ? 'command' : null;
      suggestionIndex = 0;
      renderSuggestions();
      return;
    }

    const mentionMatch = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(upToCaret);
    if (mentionMatch) {
      const query = mentionMatch[1];
      const token = Symbol('lookup');
      mentionLookup = token;

      let candidates = state.members;
      if (query.length > 0) {
        try {
          const result = await api.users.search(query);
          if (mentionLookup !== token) return;
          candidates = result.users;
        } catch {
          candidates = state.members.filter((member) =>
            member.username.toLowerCase().startsWith(query.toLowerCase())
          );
        }
      }

      suggestions = candidates
        .filter((user) => user.id !== state.user?.id)
        .slice(0, 8)
        .map((user) => ({
          label: `@${user.username}`,
          hint: user.displayName !== user.username ? user.displayName : user.statusMessage || '',
          pattern: /@[a-z0-9._-]*$/i,
          replacement: `@${user.username} `,
        }));
      suggestionMode = suggestions.length > 0 ? 'mention' : null;
      suggestionIndex = 0;
      renderSuggestions();
      return;
    }

    hideSuggestions();
  };

  // --- attachments ------------------------------------------------------

  const clearAttachment = () => {
    pendingAttachment = null;
    attachmentBar.hidden = true;
    clear(attachmentBar);
    fileInput.value = '';
  };

  const showAttachment = (attachment) => {
    clear(attachmentBar);
    attachmentBar.hidden = false;
    attachmentBar.appendChild(
      el('div', { class: 'attachment-chip' }, [
        el('span', { class: 'attachment-icon' }, [
          icon(attachment.kind === 'image' ? 'image' : 'file', { size: 16 }),
        ]),
        el('span', { class: 'attachment-name', text: attachment.name }),
        el('span', { class: 'attachment-size', text: formatBytes(attachment.size) }),
        el(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            'aria-label': 'Remove attachment',
            title: 'Remove attachment',
            onClick: clearAttachment,
          },
          [icon('x', { size: 15 })]
        ),
      ])
    );
  };

  const uploadFile = async (file) => {
    if (!file) return;

    clear(attachmentBar);
    attachmentBar.hidden = false;
    const progress = el('progress', { class: 'upload-progress', max: '1', value: '0' });
    attachmentBar.appendChild(
      el('div', { class: 'attachment-chip' }, [
        el('span', { class: 'attachment-name', text: `Uploading ${file.name}…` }),
        progress,
      ])
    );

    try {
      const result = await api.messages.upload(file, (ratio) => {
        progress.value = String(ratio);
      });
      pendingAttachment = result.attachment;
      showAttachment(result.attachment);
    } catch (error) {
      clearAttachment();
      toast(error.message, { level: 'error' });
    }
  };

  // --- context bar (reply / edit) --------------------------------------

  const renderContext = () => {
    clear(contextBar);

    if (state.editing) {
      contextBar.hidden = false;
      contextBar.appendChild(
        el('div', { class: 'context-chip' }, [
          el('span', { class: 'context-label', text: 'Editing message' }),
          el('button', {
            class: 'link-button',
            type: 'button',
            text: 'Cancel',
            onClick: () => onCancelEdit(),
          }),
        ])
      );
      return;
    }

    if (state.reply) {
      contextBar.hidden = false;
      contextBar.appendChild(
        el('div', { class: 'context-chip' }, [
          el('span', { class: 'context-label', text: `Replying to ${state.reply.authorName}` }),
          el('span', { class: 'context-excerpt', text: state.reply.excerpt }),
          el('button', {
            class: 'link-button',
            type: 'button',
            text: 'Cancel',
            onClick: () => onCancelReply(),
          }),
        ])
      );
      return;
    }

    contextBar.hidden = true;
  };

  // --- emoji picker -----------------------------------------------------

  const openEmojiPicker = (anchor, onPick) => {
    const search = el('input', {
      class: 'field-input emoji-search',
      type: 'search',
      placeholder: 'Search emoji…',
      'aria-label': 'Search emoji',
    });
    const grid = el('div', { class: 'emoji-grid' });

    const paint = (groups) => {
      clear(grid);
      for (const group of groups) {
        grid.appendChild(el('h3', { class: 'emoji-group-title', text: group.name }));
        const row = el('div', { class: 'emoji-row' });
        for (const [emoji] of group.emoji) {
          row.appendChild(
            el('button', {
              class: 'emoji-button',
              type: 'button',
              'aria-label': emoji,
              text: emoji,
              onClick: () => {
                onPick(emoji);
                handle.close();
              },
            })
          );
        }
        grid.appendChild(row);
      }
    };

    search.addEventListener('input', () => {
      const matches = searchEmoji(search.value);
      if (!matches) return paint(EMOJI_GROUPS);
      return paint([{ name: matches.length ? 'Results' : 'No matches', emoji: matches.map((m) => [m.emoji, m.keywords]) }]);
    });

    paint(EMOJI_GROUPS);
    const handle = popover(anchor, el('div', { class: 'emoji-picker' }, [search, grid]));
    return handle;
  };

  // --- sending ----------------------------------------------------------

  const reset = () => {
    textarea.value = '';
    clearAttachment();
    hideSuggestions();
    autosize();
    if (roomId) drafts.clear(roomId);
  };

  const submit = () => {
    const body = textarea.value.trim();

    if (state.editing) {
      if (!body) return;
      onSaveEdit(state.editing.id, body);
      textarea.value = '';
      autosize();
      return;
    }

    if (!body && !pendingAttachment) return;

    onSend({
      body,
      attachmentId: pendingAttachment?.id || null,
      parentId: state.reply?.id || null,
    });
    reset();
  };

  const form = el('form', {
    class: 'composer',
    onSubmit: (event) => {
      event.preventDefault();
      submit();
    },
  }, [
    contextBar,
    attachmentBar,
    el('div', { class: 'composer-row' }, [
      el(
        'button',
        {
          class: 'icon-button composer-tool',
          type: 'button',
          title: 'Attach a file',
          'aria-label': 'Attach a file',
          onClick: () => fileInput.click(),
        },
        [icon('paperclip')]
      ),
      el('div', { class: 'composer-field' }, [suggestionList, textarea]),
      el(
        'button',
        {
          class: 'icon-button composer-tool',
          type: 'button',
          title: 'Insert emoji',
          'aria-label': 'Insert emoji',
          onClick: (event) =>
            openEmojiPicker(event.currentTarget, (emoji) => {
              const caret = textarea.selectionStart;
              textarea.value = `${textarea.value.slice(0, caret)}${emoji}${textarea.value.slice(caret)}`;
              textarea.focus();
              textarea.setSelectionRange(caret + emoji.length, caret + emoji.length);
              autosize();
            }),
        },
        [icon('smile')]
      ),
      sendButton,
    ]),
    el('p', { class: 'composer-hint', id: 'composer-hint' }, [
      el('span', { text: 'Enter to send · Shift+Enter for a new line · / for commands' }),
    ]),
    fileInput,
  ]);

  // --- events -----------------------------------------------------------

  textarea.addEventListener('input', () => {
    autosize();
    updateSuggestions();
    if (roomId && !state.editing) drafts.set(roomId, textarea.value);

    const now = Date.now();
    if (textarea.value && now - lastTypingSentAt > TYPING_INTERVAL_MS) {
      lastTypingSentAt = now;
      onTyping(true);
    }
  });

  textarea.addEventListener('blur', () => {
    hideSuggestions();
    onTyping(false);
  });

  textarea.addEventListener('keydown', (event) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        return renderSuggestions();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        suggestionIndex = (suggestionIndex - 1 + suggestions.length) % suggestions.length;
        return renderSuggestions();
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && suggestionMode)) {
        event.preventDefault();
        return applySuggestion(suggestionIndex);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        return hideSuggestions();
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'Escape') {
      if (state.editing) {
        event.preventDefault();
        onCancelEdit();
      } else if (state.reply) {
        event.preventDefault();
        onCancelReply();
      }
    }
  });

  fileInput.addEventListener('change', () => uploadFile(fileInput.files[0]));

  // Drag and drop onto the composer.
  form.addEventListener('dragover', (event) => {
    event.preventDefault();
    form.classList.add('is-dragging');
  });
  form.addEventListener('dragleave', () => form.classList.remove('is-dragging'));
  form.addEventListener('drop', (event) => {
    event.preventDefault();
    form.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  // Paste an image straight from the clipboard.
  textarea.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      event.preventDefault();
      uploadFile(file);
    }
  });

  return {
    root: form,
    focus: () => textarea.focus(),
    setRoom: (nextRoomId) => {
      if (roomId && !state.editing) drafts.set(roomId, textarea.value);
      roomId = nextRoomId;
      textarea.value = drafts.get(nextRoomId);
      clearAttachment();
      hideSuggestions();
      renderContext();
      autosize();
    },
    setDisabled: (disabled, reason) => {
      textarea.disabled = disabled;
      sendButton.disabled = disabled;
      textarea.placeholder = disabled ? reason || 'You cannot post here.' : 'Write a message…  (/ for commands)';
    },
    renderContext,
    startEdit: (message) => {
      textarea.value = message.body;
      renderContext();
      autosize();
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },
    endEdit: () => {
      textarea.value = roomId ? drafts.get(roomId) : '';
      renderContext();
      autosize();
    },
    insert: (text) => {
      const caret = textarea.selectionStart;
      textarea.value = `${textarea.value.slice(0, caret)}${text}${textarea.value.slice(caret)}`;
      textarea.focus();
      textarea.setSelectionRange(caret + text.length, caret + text.length);
      autosize();
    },
    openEmojiPicker,
  };
};
