import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { CommandRegistry } = require('../../src/realtime/commands/registry');
const liveRegistry = require('../../src/realtime/commands');

describe('CommandRegistry.parse', () => {
  it('splits a command from its arguments', () => {
    expect(CommandRegistry.parse('/mute @bob 5 too loud')).toEqual({
      name: 'mute',
      args: '@bob 5 too loud',
      argv: ['@bob', '5', 'too', 'loud'],
    });
  });

  it('handles a bare command', () => {
    expect(CommandRegistry.parse('/help')).toEqual({ name: 'help', args: '', argv: [] });
  });

  it('lowercases the command name', () => {
    expect(CommandRegistry.parse('/HELP').name).toBe('help');
  });

  it('returns null for text that is not command shaped', () => {
    expect(CommandRegistry.parse('hello there')).toBeNull();
    expect(CommandRegistry.parse('/// just slashes')).toBeNull();
    expect(CommandRegistry.parse('/')).toBeNull();
    expect(CommandRegistry.parse('/1abc')).toBeNull();
    expect(CommandRegistry.parse('')).toBeNull();
  });

  it('keeps multi-line arguments intact', () => {
    const parsed = CommandRegistry.parse('/topic line one\nline two');
    expect(parsed.name).toBe('topic');
    expect(parsed.args).toBe('line one\nline two');
  });
});

describe('CommandRegistry registration', () => {
  let registry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('registers and resolves by name and alias', () => {
    registry.register({ name: 'greet', aliases: ['hi'], handler: () => 'ok' });
    expect(registry.get('greet').name).toBe('greet');
    expect(registry.get('hi').name).toBe('greet');
    expect(registry.has('nope')).toBe(false);
  });

  it('refuses a name or alias that is already taken', () => {
    registry.register({ name: 'greet', aliases: ['hi'], handler: () => {} });
    expect(() => registry.register({ name: 'greet', handler: () => {} })).toThrow(/already registered/);
    expect(() => registry.register({ name: 'other', aliases: ['hi'], handler: () => {} })).toThrow(/already registered/);
  });

  it('requires a name and a handler', () => {
    expect(() => registry.register({ name: 'x' })).toThrow();
    expect(() => registry.register({ handler: () => {} })).toThrow();
  });

  it('runs the handler with the caller context', async () => {
    let seen = null;
    registry.register({
      name: 'echo',
      requiresRoom: false,
      handler: (context) => {
        seen = context;
        return { handled: true };
      },
    });

    const result = await registry.run('echo', { user: { id: 1, role: 'user' }, args: 'hi', argv: ['hi'] });
    expect(result).toEqual({ handled: true });
    expect(seen.args).toBe('hi');
    expect(seen.command.name).toBe('echo');
  });

  it('rejects an unknown command instead of silently ignoring it', async () => {
    await expect(registry.run('nope', { user: { id: 1 } })).rejects.toThrow(/Unknown command/);
  });

  it('requires a room for room-scoped commands', async () => {
    registry.register({ name: 'here', handler: () => {} });
    await expect(registry.run('here', { user: { id: 1 }, roomId: null })).rejects.toThrow(/inside a room/);
  });

  it('blocks commands above the caller permission level', async () => {
    registry.register({ name: 'nuke', permission: 'admin', requiresRoom: false, handler: () => {} });

    await expect(
      registry.run('nuke', { user: { id: 1, role: 'user' } })
    ).rejects.toThrow(/permission/);

    await expect(registry.run('nuke', { user: { id: 2, role: 'admin' } })).resolves.toBeUndefined();
  });

  it('hides commands the user cannot run from the listing', () => {
    registry.register({ name: 'open', requiresRoom: false, handler: () => {} });
    registry.register({ name: 'secret', permission: 'admin', requiresRoom: false, handler: () => {} });
    registry.register({ name: 'invisible', hidden: true, requiresRoom: false, handler: () => {} });

    const asUser = registry.list({ user: { id: 1, role: 'user' } }).map((c) => c.name);
    expect(asUser).toContain('open');
    expect(asUser).not.toContain('secret');
    expect(asUser).not.toContain('invisible');

    const asAdmin = registry.list({ user: { id: 2, role: 'admin' } }).map((c) => c.name);
    expect(asAdmin).toContain('secret');
  });

  it('lists commands alphabetically', () => {
    registry.register({ name: 'zeta', requiresRoom: false, handler: () => {} });
    registry.register({ name: 'alpha', requiresRoom: false, handler: () => {} });
    expect(registry.list({}).map((c) => c.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('the application command registry', () => {
  it('exposes the documented commands', () => {
    for (const name of ['help', 'users', 'play', 'exit', 'me', 'shrug', 'kick', 'mute', 'ban', 'topic']) {
      expect(liveRegistry.has(name), `missing /${name}`).toBe(true);
    }
  });

  it('gives every command usage and summary text for /help', () => {
    for (const command of liveRegistry.list({})) {
      expect(command.usage, `${command.name} has no usage`).toMatch(/^\//);
      expect(command.summary.length, `${command.name} has no summary`).toBeGreaterThan(0);
    }
  });

  it('marks the moderation commands as privileged', () => {
    for (const name of ['kick', 'mute', 'unmute', 'ban', 'unban', 'topic']) {
      expect(liveRegistry.get(name).permission, `/${name} should be privileged`).not.toBe('user');
    }
  });

  it('keeps /play and /help available to everyone', () => {
    expect(liveRegistry.get('play').permission).toBe('user');
    expect(liveRegistry.get('help').permission).toBe('user');
  });
});
