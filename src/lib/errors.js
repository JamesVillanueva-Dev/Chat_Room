'use strict';

/**
 * Errors carrying an HTTP status. Anything thrown with one of these reaches the
 * client as a clean message; everything else is reported as a 500 with the
 * detail kept server-side.
 */
class AppError extends Error {
  constructor(message, { status = 500, code = null, field = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.field = field;
    this.expected = status < 500;
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, { status: 400, code: 'invalid_input', field });
  }
}

class AuthError extends AppError {
  constructor(message = 'You need to sign in.') {
    super(message, { status: 401, code: 'unauthenticated' });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, { status: 403, code: 'forbidden' });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(message, { status: 404, code: 'not_found' });
  }
}

class ConflictError extends AppError {
  constructor(message, field = null) {
    super(message, { status: 409, code: 'conflict', field });
  }
}

class RateLimitError extends AppError {
  constructor(message, retryAfterMs = 0) {
    super(message, { status: 429, code: 'rate_limited' });
    this.retryAfterMs = retryAfterMs;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
