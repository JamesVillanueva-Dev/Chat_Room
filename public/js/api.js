export class ApiError extends Error {
  constructor(message, { status = 0, field = null, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.code = code;
  }
}

const request = async (method, path, body) => {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', { code: 'offline' });
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error || `Request failed (${response.status})`, {
      status: response.status,
      field: payload.field,
      code: payload.code,
    });
  }
  return payload;
};

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const patch = (path, body) => request('PATCH', path, body);
const del = (path) => request('DELETE', path);

/** Uploads via XHR rather than fetch so the composer can show progress. */
const upload = (path, file, fieldName = 'file', onProgress) =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(fieldName, file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(payload.error || 'Upload failed.', { status: xhr.status, field: payload.field }));
    });

    xhr.addEventListener('error', () => reject(new ApiError('Upload failed.')));
    xhr.send(form);
  });

export const api = {
  auth: {
    me: () => get('/api/auth/me'),
    register: (username, password) => post('/api/auth/register', { username, password }),
    login: (username, password) => post('/api/auth/login', { username, password }),
    logout: () => post('/api/auth/logout'),
    changePassword: (currentPassword, newPassword) =>
      post('/api/auth/password', { currentPassword, newPassword }),
  },
  users: {
    search: (query) => get(`/api/users?query=${encodeURIComponent(query)}`),
    list: () => get('/api/users'),
    get: (id) => get(`/api/users/${id}`),
    updateMe: (updates) => patch('/api/users/me', updates),
    uploadAvatar: (file, onProgress) => upload('/api/users/me/avatar', file, 'avatar', onProgress),
    removeAvatar: () => del('/api/users/me/avatar'),
  },
  rooms: {
    mine: () => get('/api/rooms'),
    browse: (query = '') => get(`/api/rooms/public?query=${encodeURIComponent(query)}`),
    create: (payload) => post('/api/rooms', payload),
    get: (id) => get(`/api/rooms/${id}`),
    update: (id, updates) => patch(`/api/rooms/${id}`, updates),
    remove: (id) => del(`/api/rooms/${id}`),
    join: (id, password) => post(`/api/rooms/${id}/join`, password ? { password } : {}),
    leave: (id) => post(`/api/rooms/${id}/leave`),
    messages: (id, { before, limit } = {}) => {
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      if (limit) params.set('limit', limit);
      const query = params.toString();
      return get(`/api/rooms/${id}/messages${query ? `?${query}` : ''}`);
    },
    search: (id, query, offset = 0) =>
      get(`/api/rooms/${id}/search?q=${encodeURIComponent(query)}&offset=${offset}`),
    pinned: (id) => get(`/api/rooms/${id}/pinned`),
    members: (id) => get(`/api/rooms/${id}/members`),
    markRead: (id, messageId) => post(`/api/rooms/${id}/read`, { messageId }),
    setMemberRole: (id, userId, role) => post(`/api/rooms/${id}/members/${userId}/role`, { role }),
    invites: (id) => get(`/api/rooms/${id}/invites`),
    createInvite: (id, options = {}) => post(`/api/rooms/${id}/invites`, options),
    revokeInvite: (id, code) => del(`/api/rooms/${id}/invites/${code}`),
  },
  invites: {
    preview: (code) => get(`/api/invites/${code}`),
    accept: (code) => post(`/api/invites/${code}/accept`),
  },
  dms: {
    open: (userId) => post('/api/dms', { userId }),
  },
  messages: {
    thread: (id) => get(`/api/messages/${id}/thread`),
    upload: (file, onProgress) => upload('/api/messages/uploads', file, 'file', onProgress),
  },
  admin: {
    overview: () => get('/api/admin/overview'),
    ban: (id, reason) => post(`/api/admin/users/${id}/ban`, { reason }),
    unban: (id) => post(`/api/admin/users/${id}/unban`),
    mute: (id, minutes, reason) => post(`/api/admin/users/${id}/mute`, { minutes, reason }),
    unmute: (id) => post(`/api/admin/users/${id}/unmute`),
    setRole: (id, role) => post(`/api/admin/users/${id}/role`, { role }),
  },
};
