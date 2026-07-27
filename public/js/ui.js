import { el, clear, append } from './dom.js';

// --- theme --------------------------------------------------------------

const THEME_KEY = 'chatroom.theme';

export const theme = {
  get() {
    return localStorage.getItem(THEME_KEY) || 'system';
  },

  apply(value) {
    const resolved =
      value === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : value;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    return resolved;
  },

  set(value) {
    localStorage.setItem(THEME_KEY, value);
    return theme.apply(value);
  },

  cycle() {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme.get()) + 1) % order.length];
    theme.set(next);
    return next;
  },

  init() {
    theme.apply(theme.get());
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (theme.get() === 'system') theme.apply('system');
      });
  },
};

// --- toasts -------------------------------------------------------------

let toastHost = null;

const ensureToastHost = () => {
  if (!toastHost) {
    toastHost = el('div', {
      class: 'toast-host',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });
    document.body.appendChild(toastHost);
  }
  return toastHost;
};

export const toast = (text, { level = 'info', timeout = 5000 } = {}) => {
  const host = ensureToastHost();
  const node = el('div', { class: `toast toast-${level}` }, [
    el('div', { class: 'toast-text', text }),
    el('button', {
      class: 'toast-close',
      type: 'button',
      'aria-label': 'Dismiss notification',
      text: '×',
      onClick: () => node.remove(),
    }),
  ]);

  host.appendChild(node);
  if (timeout > 0) setTimeout(() => node.remove(), timeout);
  return node;
};

/** Multi-line server replies (like /help) read better in a monospaced block. */
export const noticeToast = (text, level = 'info') => {
  const host = ensureToastHost();
  const multiline = text.includes('\n');
  const node = el('div', { class: `toast toast-${level}${multiline ? ' toast-wide' : ''}` }, [
    multiline
      ? el('pre', { class: 'toast-pre', text })
      : el('div', { class: 'toast-text', text }),
    el('button', {
      class: 'toast-close',
      type: 'button',
      'aria-label': 'Dismiss notification',
      text: '×',
      onClick: () => node.remove(),
    }),
  ]);

  host.appendChild(node);
  setTimeout(() => node.remove(), multiline ? 20000 : 6000);
  return node;
};

// --- modals -------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModal = null;

/**
 * Opens a dialog that traps focus, closes on Escape or backdrop click, and
 * returns focus to whatever was focused before it opened.
 */
export const modal = ({ title, body, actions = [], width = 'md', onClose }) => {
  closeModal();

  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${Date.now()}`;

  const dialog = el(
    'div',
    { class: `modal modal-${width}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    [
      el('header', { class: 'modal-head' }, [
        el('h2', { id: titleId, text: title }),
        el('button', {
          class: 'icon-button',
          type: 'button',
          'aria-label': 'Close dialog',
          text: '×',
          onClick: () => closeModal(),
        }),
      ]),
      el('div', { class: 'modal-body' }, [body]),
      actions.length > 0 ? el('footer', { class: 'modal-foot' }, actions) : null,
    ]
  );

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onClick: (event) => {
      if (event.target === backdrop) closeModal();
    },
  }, [dialog]);

  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  backdrop.addEventListener('keydown', onKeydown);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');

  const focusTarget = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUSABLE);
  focusTarget?.focus();

  openModal = {
    backdrop,
    dialog,
    close: () => {
      backdrop.remove();
      document.body.classList.remove('modal-open');
      previouslyFocused?.focus?.();
      onClose?.();
    },
  };

  return openModal;
};

export const closeModal = () => {
  if (!openModal) return;
  const current = openModal;
  openModal = null;
  current.close();
};

export const isModalOpen = () => Boolean(openModal);

export const confirmDialog = ({ title, message, confirmLabel = 'Confirm', danger = false }) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    modal({
      title,
      body: el('p', { class: 'modal-message', text: message }),
      width: 'sm',
      onClose: () => finish(false),
      actions: [
        el('button', {
          class: 'button button-ghost',
          type: 'button',
          text: 'Cancel',
          onClick: () => {
            finish(false);
            closeModal();
          },
        }),
        el('button', {
          class: `button ${danger ? 'button-danger' : 'button-primary'}`,
          type: 'button',
          text: confirmLabel,
          'data-autofocus': '',
          onClick: () => {
            finish(true);
            closeModal();
          },
        }),
      ],
    });
  });

export const promptDialog = ({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) =>
  new Promise((resolve) => {
    let settled = false;
    const input = el('input', { class: 'field-input', type: 'text', value, placeholder, 'data-autofocus': '' });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const submit = () => {
      finish(input.value);
      closeModal();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    modal({
      title,
      width: 'sm',
      body: el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), input]),
      onClose: () => finish(null),
      actions: [
        el('button', {
          class: 'button button-ghost',
          type: 'button',
          text: 'Cancel',
          onClick: () => {
            finish(null);
            closeModal();
          },
        }),
        el('button', { class: 'button button-primary', type: 'button', text: confirmLabel, onClick: submit }),
      ],
    });
  });

/** Lightweight anchored popover used by the emoji picker and message menus. */
export const popover = (anchor, content, { align = 'end' } = {}) => {
  const existing = document.querySelector('.popover');
  existing?.remove();

  const node = el('div', { class: 'popover', role: 'dialog' }, [content]);
  document.body.appendChild(node);

  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = node;

  let left = align === 'end' ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.top - height - 8;
  if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8);

  node.style.left = `${left}px`;
  node.style.top = `${Math.max(8, top)}px`;

  const dismiss = (event) => {
    if (node.contains(event.target) || anchor.contains(event.target)) return;
    close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      close();
      anchor.focus();
    }
  };

  const close = () => {
    node.remove();
    document.removeEventListener('mousedown', dismiss);
    document.removeEventListener('keydown', onKey);
  };

  setTimeout(() => {
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
  }, 0);

  node.querySelector(FOCUSABLE)?.focus();
  return { node, close };
};

export const field = ({ label, input, hint }) =>
  el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    input,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  ]);

export const emptyState = (text, action) =>
  el('div', { class: 'empty-state' }, [el('p', { text }), action]);

export { el, clear, append };
