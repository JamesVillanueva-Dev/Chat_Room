'use strict';

const attachments = require('../db/repositories/attachments');
const messages = require('../db/repositories/messages');
const rooms = require('../db/repositories/rooms');
const logger = require('../logger').child({ component: 'chat' });
const mentions = require('./mentions');
const metrics = require('./metrics');
const permissions = require('./permissions');
const unfurl = require('./unfurl');
const validate = require('../lib/validate');
const { bus, EVENTS } = require('./events');
const { ForbiddenError, NotFoundError, ValidationError } = require('../lib/errors');

/**
 * Fetches link metadata after the message is already delivered, then pushes an
 * update if anything was found. Sending never waits on a third-party request.
 */
const unfurlInBackground = (message) => {
  if (!message.linkUrlPending) return;

  unfurl
    .unfurl(message.linkUrlPending)
    .then((preview) => {
      if (!preview) return;
      const refreshed = messages.getById(message.id);
      if (refreshed && !refreshed.isDeleted) {
        bus.emit(EVENTS.MESSAGE_UPDATED, refreshed);
      }
    })
    .catch((error) => logger.debug('unfurl skipped', { error: error.message }));
};

const postUserMessage = ({ user, roomId, body, parentId = null, attachmentId = null }) => {
  const room = permissions.assertCanPost(user, roomId);
  const hasAttachment = attachmentId !== null && attachmentId !== undefined;
  const cleanBody = validate.messageBody(body, { allowEmpty: hasAttachment });

  if (!cleanBody && !hasAttachment) {
    throw new ValidationError('Message cannot be empty.', 'message');
  }

  if (parentId) {
    const parent = messages.getRawById(parentId);
    if (!parent || parent.room_id !== roomId) {
      throw new ValidationError('You can only reply to a message in this room.', 'parentId');
    }
  }

  if (hasAttachment) {
    const attachment = attachments.findById(attachmentId);
    if (!attachment) throw new NotFoundError('That upload no longer exists.');
    if (attachment.uploaderId !== user.id) {
      throw new ForbiddenError('You can only attach your own uploads.');
    }
  }

  const resolved = mentions.resolve(cleanBody, { roomId, authorId: user.id, author: user });
  const linkUrl = unfurl.firstUrl(cleanBody);

  const message = messages.createAndReturn({
    roomId,
    userId: user.id,
    body: cleanBody,
    parentId,
    attachmentId: hasAttachment ? attachmentId : null,
    linkUrl,
    mentionUserIds: resolved.userIds,
  });

  rooms.markRead(roomId, user.id, message.id);
  metrics.messageSent();

  bus.emit(EVENTS.MESSAGE_CREATED, message);
  if (resolved.userIds.length > 0) {
    bus.emit(EVENTS.MENTION, { userIds: resolved.userIds, message, room });
  }

  unfurlInBackground({ ...message, linkUrlPending: linkUrl });
  return message;
};

const postSystemMessage = (roomId, body) => {
  const message = messages.createAndReturn({ roomId, kind: 'system', body, authorLabel: 'System' });
  bus.emit(EVENTS.MESSAGE_CREATED, message);
  return message;
};

const postBotMessage = ({ roomId, body, label = 'Bot', parentId = null }) => {
  const message = messages.createAndReturn({
    roomId,
    kind: 'bot',
    body,
    authorLabel: label,
    parentId,
  });
  metrics.messageSent();
  bus.emit(EVENTS.MESSAGE_CREATED, message);
  return message;
};

const editMessage = ({ user, messageId, body }) => {
  const existing = messages.getById(messageId);
  if (!existing) throw new NotFoundError('That message no longer exists.');
  if (!permissions.canEditMessage(user, existing)) {
    throw new ForbiddenError('You can only edit your own messages.');
  }
  permissions.assertCanPost(user, existing.roomId);

  const cleanBody = validate.messageBody(body, { allowEmpty: Boolean(existing.attachment) });
  const resolved = mentions.resolve(cleanBody, {
    roomId: existing.roomId,
    authorId: user.id,
    author: user,
  });

  messages.updateBody(messageId, cleanBody);
  messages.replaceMentions(messageId, resolved.userIds);

  const linkUrl = unfurl.firstUrl(cleanBody);
  messages.attachLinkUrl(messageId, linkUrl);

  const updated = messages.getById(messageId);
  bus.emit(EVENTS.MESSAGE_UPDATED, updated);
  unfurlInBackground({ ...updated, linkUrlPending: linkUrl });
  return updated;
};

const deleteMessage = ({ user, messageId }) => {
  const existing = messages.getById(messageId);
  if (!existing) throw new NotFoundError('That message no longer exists.');
  if (!permissions.canDeleteMessage(user, existing)) {
    throw new ForbiddenError('You cannot delete that message.');
  }

  const deleted = messages.softDelete(messageId);
  bus.emit(EVENTS.MESSAGE_DELETED, { id: messageId, roomId: existing.roomId, message: deleted });
  return deleted;
};

/** Adds the reaction, or removes it when the user already reacted with it. */
const toggleReaction = ({ user, messageId, emoji }) => {
  const message = messages.getById(messageId);
  if (!message || message.isDeleted) throw new NotFoundError('That message no longer exists.');
  permissions.assertCanView(user, message.roomId);

  const clean = validate.emoji(emoji);
  const had = messages.hasReaction(messageId, user.id, clean);
  const reactions = had
    ? messages.removeReaction(messageId, user.id, clean)
    : messages.addReaction(messageId, user.id, clean);

  bus.emit(EVENTS.MESSAGE_REACTIONS, { messageId, roomId: message.roomId, reactions });
  return { reactions, added: !had };
};

const togglePin = ({ user, messageId }) => {
  const message = messages.getById(messageId);
  if (!message || message.isDeleted) throw new NotFoundError('That message no longer exists.');
  permissions.assertRoomModerator(user, message.roomId);

  const pinned = !message.pinnedAt;
  const updated = messages.setPinned(messageId, user.id, pinned);

  bus.emit(EVENTS.MESSAGE_UPDATED, updated);
  bus.emit(EVENTS.MESSAGE_PINNED, { roomId: message.roomId, message: updated, pinned });
  return updated;
};

module.exports = {
  postUserMessage,
  postSystemMessage,
  postBotMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  togglePin,
};
