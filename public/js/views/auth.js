import { api } from '../api.js';
import { el, clear } from '../dom.js';

/**
 * Sign-in / sign-up screen. Renders into the given host and calls `onSignedIn`
 * with the authenticated user.
 */
export const renderAuth = (host, { onSignedIn, inviteCode = null }) => {
  let mode = 'login';

  const errorBox = el('p', { class: 'auth-error', role: 'alert', hidden: true });
  const usernameInput = el('input', {
    class: 'field-input',
    id: 'auth-username',
    name: 'username',
    autocomplete: 'username',
    required: true,
    maxlength: '24',
    'data-autofocus': '',
  });
  const passwordInput = el('input', {
    class: 'field-input',
    id: 'auth-password',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
  });

  const submitButton = el('button', { class: 'button button-primary button-block', type: 'submit' });
  const toggleButton = el('button', { class: 'link-button', type: 'button' });
  const heading = el('h1', { class: 'auth-title' });
  const subheading = el('p', { class: 'auth-subtitle' });

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  const applyMode = () => {
    const isLogin = mode === 'login';
    heading.textContent = isLogin ? 'Welcome back' : 'Create your account';
    subheading.textContent = isLogin
      ? 'Sign in to rejoin the conversation.'
      : 'Pick a name and a password to get started.';
    submitButton.textContent = isLogin ? 'Sign in' : 'Create account';
    toggleButton.textContent = isLogin ? 'Need an account? Sign up' : 'Already have an account? Sign in';
    passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
    showError('');
  };

  toggleButton.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
    usernameInput.focus();
  });

  const form = el(
    'form',
    {
      class: 'auth-form',
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        showError('');
        submitButton.disabled = true;

        try {
          const username = usernameInput.value.trim();
          const password = passwordInput.value;
          const result =
            mode === 'login'
              ? await api.auth.login(username, password)
              : await api.auth.register(username, password);
          onSignedIn(result.user);
        } catch (error) {
          showError(error.message);
          if (error.field === 'username') usernameInput.focus();
          else passwordInput.focus();
        } finally {
          submitButton.disabled = false;
        }
      },
    },
    [
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label', for: 'auth-username', text: 'Username' }),
        usernameInput,
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label', for: 'auth-password', text: 'Password' }),
        passwordInput,
        el('span', { class: 'field-hint', text: 'At least 8 characters.' }),
      ]),
      errorBox,
      submitButton,
    ]
  );

  clear(host).appendChild(
    el('div', { class: 'auth-screen' }, [
      el('div', { class: 'auth-card' }, [
        el('div', { class: 'auth-brand' }, [
          el('span', { class: 'auth-logo', 'aria-hidden': 'true', text: '💬' }),
          el('span', { class: 'auth-brand-name', text: 'Chat Room' }),
        ]),
        heading,
        subheading,
        inviteCode
          ? el('p', { class: 'auth-invite', text: 'Sign in to accept your room invitation.' })
          : null,
        form,
        el('div', { class: 'auth-toggle' }, [toggleButton]),
      ]),
    ])
  );

  applyMode();
  usernameInput.focus();
};
