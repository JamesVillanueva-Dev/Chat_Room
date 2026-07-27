'use strict';

const config = require('../config');

/**
 * Sliding-window limiter with escalating penalties.
 *
 * Staying under `max` actions per `windowMs` costs nothing. Going over starts a
 * cooldown that doubles for each repeat offence (backoffMs, 2x, 4x … capped at
 * backoffMaxMs), so an occasional burst is forgiven while sustained flooding
 * gets progressively more expensive. Offence counts decay once the offender has
 * been quiet for two windows.
 */
class RateLimiter {
  constructor({
    windowMs = config.limits.windowMs,
    max = config.limits.maxMessages,
    backoffMs = config.limits.backoffMs,
    backoffMaxMs = config.limits.backoffMaxMs,
    decayWindows = 2,
    now = () => Date.now(),
  } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.backoffMs = backoffMs;
    this.backoffMaxMs = backoffMaxMs;
    this.decayWindows = decayWindows;
    this.now = now;
    this.entries = new Map();
  }

  entryFor(key) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { hits: [], offences: 0, blockedUntil: 0, lastHitAt: 0, lastSeen: this.now() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Records an action. Returns `{ allowed }`, and when blocked also the wait in
   * milliseconds so the caller can tell the user when to try again.
   */
  consume(key) {
    const now = this.now();
    const entry = this.entryFor(key);
    entry.lastSeen = now;

    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfterMs: entry.blockedUntil - now, offences: entry.offences };
    }

    // Forgive earlier offences only after a genuinely quiet stretch, measured
    // from whichever came last: the previous request or the end of the penalty.
    // Measuring from the request alone would let someone who sits out a long
    // cooldown start again at the smallest penalty every time.
    const quietSince = Math.max(entry.blockedUntil, entry.lastHitAt);
    if (entry.offences > 0 && now - quietSince > this.windowMs * this.decayWindows) {
      entry.offences = 0;
    }

    const cutoff = now - this.windowMs;
    entry.hits = entry.hits.filter((time) => time > cutoff);

    if (entry.hits.length >= this.max) {
      entry.offences += 1;
      const penalty = Math.min(
        this.backoffMs * 2 ** (entry.offences - 1),
        this.backoffMaxMs
      );
      entry.blockedUntil = now + penalty;
      return { allowed: false, retryAfterMs: penalty, offences: entry.offences };
    }

    entry.hits.push(now);
    entry.lastHitAt = now;
    return { allowed: true, remaining: this.max - entry.hits.length, offences: entry.offences };
  }

  /** Current state without recording an action. */
  peek(key) {
    const entry = this.entries.get(key);
    if (!entry) return { blocked: false, retryAfterMs: 0 };
    const now = this.now();
    return {
      blocked: entry.blockedUntil > now,
      retryAfterMs: Math.max(0, entry.blockedUntil - now),
      offences: entry.offences,
    };
  }

  reset(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  /** Drops keys nobody has touched recently so the map cannot grow forever. */
  sweep(maxIdleMs = 10 * 60 * 1000) {
    const cutoff = this.now() - maxIdleMs;
    for (const [key, entry] of this.entries) {
      if (entry.lastSeen < cutoff && entry.blockedUntil < this.now()) {
        this.entries.delete(key);
      }
    }
  }

  get size() {
    return this.entries.size;
  }
}

/** Counts concurrent connections per address to cap a single noisy client. */
class ConnectionCounter {
  constructor(max = config.limits.connectionsPerIp) {
    this.max = max;
    this.counts = new Map();
  }

  tryAdd(key) {
    const current = this.counts.get(key) || 0;
    if (current >= this.max) return false;
    this.counts.set(key, current + 1);
    return true;
  }

  remove(key) {
    const current = this.counts.get(key) || 0;
    if (current <= 1) this.counts.delete(key);
    else this.counts.set(key, current - 1);
  }

  get(key) {
    return this.counts.get(key) || 0;
  }

  clear() {
    this.counts.clear();
  }
}

module.exports = { RateLimiter, ConnectionCounter };
