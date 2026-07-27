'use strict';

const config = require('../../config');
const rooms = require('../../db/repositories/rooms');
const users = require('../../db/repositories/users');
const moderationService = require('../../services/moderationService');
const validate = require('../../lib/validate');
const rps = require('./rps');
const { CommandRegistry } = require('./registry');
const { bus, EVENTS } = require('../../services/events');
const { ValidationError } = require('../../lib/errors');

const registry = new CommandRegistry();

const PRESENCE_ICON = { online: '●', away: '○', busy: '◆', offline: '·' };

/** Splits "@name rest of the args" into the target and what follows. */
const takeTarget = (argv, commandName) => {
  if (argv.length === 0) {
    throw new ValidationError(`Who? Usage: /${commandName} @username`);
  }
  return { target: argv[0].replace(/^@/, ''), rest: argv.slice(1) };
};

registry.register({
  name: 'help',
  summary: 'List the commands you can use, or explain one of them.',
  usage: '/help [command]',
  requiresRoom: false,
  handler: ({ args, user, roomId, registry: reg, reply }) => {
    if (args) {
      const command = reg.get(args.replace(/^\//, ''));
      if (!command) return reply(`There is no /${args} command.`);
      if (!reg.canRun(command, user, roomId)) {
        return reply(`You do not have permission to use /${command.name}.`);
      }
      const aliases = command.aliases.length ? `\nAliases: ${command.aliases.map((a) => `/${a}`).join(', ')}` : '';
      return reply(`${command.usage}\n${command.summary}${aliases}`);
    }

    const lines = reg
      .list({ user, roomId })
      .map((command) => `${command.usage.padEnd(28)} ${command.summary}`);

    return reply(`Commands available to you:\n${lines.join('\n')}`);
  },
});

registry.register({
  name: 'users',
  aliases: ['who'],
  summary: 'Show who is in this room and their status.',
  usage: '/users',
  handler: ({ roomId, reply }) => {
    const members = rooms.listMembers(roomId);
    const lines = members.map((member) => {
      const icon = PRESENCE_ICON[member.presence] || '·';
      const role = member.roomRole === 'member' ? '' : ` (${member.roomRole})`;
      const status = member.statusMessage ? ` — ${member.statusMessage}` : '';
      return `${icon} ${member.username}${role}${status}`;
    });
    return reply(`${members.length} member(s) in this room:\n${lines.join('\n')}`);
  },
});

registry.register({
  name: 'whois',
  summary: 'Show a profile.',
  usage: '/whois @username',
  handler: ({ argv, reply }) => {
    const { target } = takeTarget(argv, 'whois');
    const user = users.findByUsername(target);
    if (!user) return reply(`No user called ${target}.`);

    const details = [
      `${user.displayName} (@${user.username})`,
      `Role: ${user.role}`,
      `Presence: ${user.presence}${user.statusMessage ? ` — ${user.statusMessage}` : ''}`,
      user.bio ? `Bio: ${user.bio}` : null,
      `Joined: ${new Date(user.createdAt).toLocaleDateString()}`,
    ].filter(Boolean);

    return reply(details.join('\n'));
  },
});

registry.register({
  name: 'me',
  summary: 'Send an action, like /me refills the coffee.',
  usage: '/me <action>',
  handler: ({ args, user, say }) => {
    if (!args) throw new ValidationError('Usage: /me <action>');
    return say(`* ${user.username} ${args}`);
  },
});

registry.register({
  name: 'shrug',
  summary: 'Append a shrug to your message.',
  usage: '/shrug [message]',
  handler: ({ args, postAsUser }) => postAsUser(`${args} ¯\\_(ツ)_/¯`.trim()),
});

registry.register({
  name: 'status',
  summary: 'Set the status line shown next to your name.',
  usage: '/status [text]',
  requiresRoom: false,
  handler: ({ args, user, reply }) => {
    const statusMessage = validate.boundedText(args, {
      field: 'status',
      max: config.chat.maxStatusMessageLength,
    });
    const updated = users.updateProfile(user.id, { statusMessage });
    bus.emit(EVENTS.USER_UPDATED, updated);
    return reply(statusMessage ? `Status set to "${statusMessage}".` : 'Status cleared.');
  },
});

for (const presence of ['online', 'away', 'busy']) {
  registry.register({
    name: presence,
    summary: `Mark yourself as ${presence}.`,
    usage: `/${presence}`,
    requiresRoom: false,
    handler: ({ user, reply }) => {
      const updated = users.updateProfile(user.id, { presence });
      bus.emit(EVENTS.USER_UPDATED, updated);
      return reply(`You are now ${presence}.`);
    },
  });
}

registry.register({
  name: 'topic',
  summary: 'Set the topic for this room.',
  usage: '/topic <text>',
  permission: 'moderator',
  handler: ({ args, roomId, reply, system }) => {
    const topic = validate.boundedText(args, { field: 'topic', max: config.chat.maxTopicLength });
    const room = rooms.updateRoom(roomId, { topic });
    bus.emit(EVENTS.ROOM_UPDATED, room);
    system(topic ? `Topic set to "${topic}".` : 'Topic cleared.');
    return reply('Topic updated.');
  },
});

registry.register({
  name: 'invite',
  summary: 'Create an invite link for this room.',
  usage: '/invite [minutes]',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply, origin }) => {
    const expiresInMinutes = argv[0] ? validate.positiveInt(argv[0], 'minutes', { max: 60 * 24 * 30 }) : null;
    const invite = rooms.createInvite(roomId, user.id, { expiresInMinutes });
    const link = `${origin || ''}/invite/${invite.code}`;
    const expiry = expiresInMinutes ? ` It expires in ${expiresInMinutes} minute(s).` : '';
    return reply(`Invite link: ${link}${expiry}`);
  },
});

// --- moderation ---------------------------------------------------------

registry.register({
  name: 'kick',
  summary: 'Remove someone from this room.',
  usage: '/kick @username [reason]',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target, rest } = takeTarget(argv, 'kick');
    moderationService.kick({ actor: user, target, roomId, reason: rest.join(' ') });
    return reply(`${target} was removed from the room.`);
  },
});

registry.register({
  name: 'mute',
  summary: 'Mute someone in this room for a number of minutes (default 10).',
  usage: '/mute @username [minutes] [reason]',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target, rest } = takeTarget(argv, 'mute');
    const hasMinutes = rest.length > 0 && /^\d+$/.test(rest[0]);
    const minutes = hasMinutes ? Number(rest[0]) : 10;
    const reason = (hasMinutes ? rest.slice(1) : rest).join(' ');

    const outcome = moderationService.mute({ actor: user, target, roomId, minutes, reason });
    return reply(`${outcome.target.username} is muted for ${outcome.minutes} minute(s).`);
  },
});

registry.register({
  name: 'unmute',
  summary: 'Remove a mute in this room.',
  usage: '/unmute @username',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target } = takeTarget(argv, 'unmute');
    moderationService.unmute({ actor: user, target, roomId });
    return reply(`${target} can post again.`);
  },
});

registry.register({
  name: 'ban',
  summary: 'Ban someone from this room. Server admins can add --server to ban everywhere.',
  usage: '/ban @username [--server] [reason]',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target, rest } = takeTarget(argv, 'ban');
    const serverWide = rest.includes('--server');
    const reason = rest.filter((word) => word !== '--server').join(' ');

    const outcome = moderationService.ban({
      actor: user,
      target,
      roomId: serverWide ? null : roomId,
      reason,
    });
    return reply(
      `${outcome.target.username} is banned from ${outcome.scope === 'server' ? 'the server' : 'this room'}.`
    );
  },
});

registry.register({
  name: 'unban',
  summary: 'Lift a ban in this room, or server-wide with --server.',
  usage: '/unban @username [--server]',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target, rest } = takeTarget(argv, 'unban');
    const serverWide = rest.includes('--server');
    const outcome = moderationService.unban({ actor: user, target, roomId: serverWide ? null : roomId });
    return reply(`${outcome.target.username} is unbanned.`);
  },
});

registry.register({
  name: 'roomrole',
  summary: 'Set someone as member, moderator or owner of this room.',
  usage: '/roomrole @username <member|moderator|owner>',
  permission: 'moderator',
  handler: ({ argv, roomId, user, reply }) => {
    const { target, rest } = takeTarget(argv, 'roomrole');
    if (rest.length === 0) throw new ValidationError('Usage: /roomrole @username <member|moderator|owner>');
    const outcome = moderationService.setRoomRole({ actor: user, target, roomId, role: rest[0] });
    return reply(`${outcome.target.username} is now a room ${outcome.role}.`);
  },
});

// --- rock paper scissors ------------------------------------------------

registry.register({
  name: 'play',
  summary: 'Play rock paper scissors against the bot.',
  usage: '/play <rock|paper|scissors|reset>',
  handler: async ({ args, user, reply, say }) => {
    if (!config.rps.enabled) return reply('The rock paper scissors bot is switched off.');

    const choice = args.toLowerCase();
    if (!choice) {
      return reply('Pick one: /play rock, /play paper or /play scissors.');
    }
    if (choice === 'reset') {
      rps.resetScore(user.id);
      return reply('Your rock paper scissors score is back to 0–0.');
    }

    try {
      const outcome = await rps.play({ userId: user.id, username: user.username, choice });
      return say(outcome.text, rps.BOT_LABEL);
    } catch (error) {
      if (error instanceof rps.RpsError) return reply(error.message);
      throw error;
    }
  },
});

registry.register({
  name: 'exit',
  summary: 'Stop playing rock paper scissors and clear your score.',
  usage: '/exit',
  handler: ({ user, reply }) => {
    rps.resetScore(user.id);
    return reply('Thanks for playing. Your score is cleared — type /play to start again.');
  },
});

module.exports = registry;
