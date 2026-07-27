'use strict';

const users = require('../db/repositories/users');

/**
 * Tracks which sockets belong to which user.
 *
 * A user is online while at least one socket is open, so a second tab or a
 * brief reconnect does not flip them offline. A presence the user chose
 * themselves (away/busy) is preserved on reconnect instead of being reset.
 */
class PresenceTracker {
  constructor() {
    this.socketsByUser = new Map();
  }

  add(userId, socketId) {
    let sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.socketsByUser.set(userId, sockets);
    }
    sockets.add(socketId);
    return sockets.size === 1;
  }

  remove(userId, socketId) {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return true;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId) {
    return this.socketsByUser.has(userId);
  }

  socketCount(userId) {
    return this.socketsByUser.get(userId)?.size || 0;
  }

  onlineUserIds() {
    return [...this.socketsByUser.keys()];
  }

  /** Marks the user online, keeping a deliberate away/busy choice intact. */
  connect(userId, socketId) {
    const isFirst = this.add(userId, socketId);
    if (!isFirst) return null;

    const user = users.findById(userId);
    if (!user) return null;
    if (user.presence === 'offline') return users.setPresence(userId, 'online');

    users.touchLastSeen(userId);
    return user;
  }

  disconnect(userId, socketId) {
    const wasLast = this.remove(userId, socketId);
    if (!wasLast) return null;
    return users.setPresence(userId, 'offline');
  }

  clear() {
    this.socketsByUser.clear();
  }
}

module.exports = { PresenceTracker };
