'use strict';

const permissions = require('../../services/permissions');
const { ForbiddenError, ValidationError } = require('../../lib/errors');

const PERMISSION_LEVELS = { user: 0, moderator: 1, admin: 2 };

/**
 * Holds every slash command as data: name, help text, required permission and
 * handler. `/help` is generated from the same records, so adding a command is a
 * single `register()` call rather than another branch in a dispatch chain.
 */
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  register(definition) {
    const { name, handler } = definition;
    if (!name || typeof handler !== 'function') {
      throw new Error('A command needs a name and a handler.');
    }
    if (this.commands.has(name) || this.aliases.has(name)) {
      throw new Error(`Command "${name}" is already registered.`);
    }

    const command = {
      name,
      aliases: definition.aliases || [],
      summary: definition.summary || '',
      usage: definition.usage || `/${name}`,
      permission: definition.permission || 'user',
      requiresRoom: definition.requiresRoom !== false,
      hidden: Boolean(definition.hidden),
      handler,
    };

    this.commands.set(name, command);
    for (const alias of command.aliases) {
      if (this.commands.has(alias) || this.aliases.has(alias)) {
        throw new Error(`Alias "${alias}" is already registered.`);
      }
      this.aliases.set(alias, name);
    }

    return this;
  }

  get(name) {
    const key = String(name || '').toLowerCase();
    return this.commands.get(key) || this.commands.get(this.aliases.get(key));
  }

  has(name) {
    return Boolean(this.get(name));
  }

  /**
   * Splits `/name rest of the line` into its parts.
   * Returns null when the text is not a command, so ordinary messages that
   * merely start with a slash-like character fall through unchanged.
   */
  static parse(text) {
    const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(String(text).trim());
    if (!match) return null;

    const rest = (match[2] || '').trim();
    return {
      name: match[1].toLowerCase(),
      args: rest,
      argv: rest.length > 0 ? rest.split(/\s+/) : [],
    };
  }

  canRun(command, user, roomId) {
    const required = PERMISSION_LEVELS[command.permission] ?? 0;
    if (required === 0) return true;
    if (permissions.isAdmin(user)) return true;
    if (required === PERMISSION_LEVELS.admin) return false;
    return Boolean(roomId) && permissions.isRoomModerator(user, roomId);
  }

  /** Commands the given user may actually run here, for help and autocomplete. */
  list({ user, roomId } = {}) {
    return [...this.commands.values()]
      .filter((command) => !command.hidden)
      .filter((command) => !user || this.canRun(command, user, roomId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async run(name, context) {
    const command = this.get(name);
    if (!command) {
      throw new ValidationError(`Unknown command /${name}. Type /help to see what is available.`);
    }
    if (command.requiresRoom && !context.roomId) {
      throw new ValidationError(`/${command.name} has to be used inside a room.`);
    }
    if (!this.canRun(command, context.user, context.roomId)) {
      throw new ForbiddenError(`You do not have permission to use /${command.name}.`);
    }

    return command.handler({ ...context, command, registry: this });
  }
}

module.exports = { CommandRegistry, PERMISSION_LEVELS };
