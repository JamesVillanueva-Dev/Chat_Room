import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { RateLimiter, ConnectionCounter } = require('../../src/realtime/rateLimiter');

/** A limiter driven by a clock we control, so nothing depends on real time. */
const makeLimiter = (overrides = {}) => {
  let now = 1_000_000;
  const limiter = new RateLimiter({
    windowMs: 1000,
    max: 3,
    backoffMs: 500,
    backoffMaxMs: 4000,
    now: () => now,
    ...overrides,
  });
  return { limiter, advance: (ms) => { now += ms; }, at: () => now };
};

describe('RateLimiter', () => {
  it('allows up to the limit inside the window', () => {
    const { limiter } = makeLimiter();
    expect(limiter.consume('u1').allowed).toBe(true);
    expect(limiter.consume('u1').allowed).toBe(true);
    expect(limiter.consume('u1').allowed).toBe(true);
    expect(limiter.consume('u1').allowed).toBe(false);
  });

  it('reports how long to wait when blocked', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 3; i += 1) limiter.consume('u1');
    const blocked = limiter.consume('u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(500);
  });

  it('doubles the penalty for repeat offences and caps it', () => {
    const { limiter, advance } = makeLimiter();
    const penalties = [];

    for (let round = 0; round < 5; round += 1) {
      // Exhaust the window, take the penalty, then wait it out.
      for (let i = 0; i < 3; i += 1) limiter.consume('spammer');
      const blocked = limiter.consume('spammer');
      penalties.push(blocked.retryAfterMs);
      advance(blocked.retryAfterMs);
    }

    expect(penalties[0]).toBe(500);
    expect(penalties[1]).toBe(1000);
    expect(penalties[2]).toBe(2000);
    expect(penalties[3]).toBe(4000);
    expect(penalties[4]).toBe(4000); // capped at backoffMaxMs
  });

  it('lets traffic through again once the window slides past', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 3; i += 1) limiter.consume('u1');
    expect(limiter.consume('u1').allowed).toBe(false);

    advance(600); // penalty expires
    advance(1100); // and the window empties
    expect(limiter.consume('u1').allowed).toBe(true);
  });

  it('forgives earlier offences after a long quiet period', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 3; i += 1) limiter.consume('u1');
    expect(limiter.consume('u1').offences).toBe(1);

    advance(10000); // quiet for far longer than two windows
    limiter.consume('u1');
    for (let i = 0; i < 3; i += 1) limiter.consume('u1');
    const blocked = limiter.consume('u1');
    expect(blocked.retryAfterMs).toBe(500); // back to the first-offence penalty
  });

  it('keeps separate budgets per key', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 3; i += 1) limiter.consume('noisy');
    expect(limiter.consume('noisy').allowed).toBe(false);
    expect(limiter.consume('quiet').allowed).toBe(true);
  });

  it('peek does not consume budget', () => {
    const { limiter } = makeLimiter();
    limiter.consume('u1');
    limiter.peek('u1');
    limiter.peek('u1');
    expect(limiter.consume('u1').allowed).toBe(true);
    expect(limiter.consume('u1').allowed).toBe(true);
    expect(limiter.consume('u1').allowed).toBe(false);
  });

  it('sweeps idle keys so the map cannot grow without bound', () => {
    const { limiter, advance } = makeLimiter();
    limiter.consume('a');
    limiter.consume('b');
    expect(limiter.size).toBe(2);

    advance(60 * 60 * 1000);
    limiter.sweep(10 * 60 * 1000);
    expect(limiter.size).toBe(0);
  });
});

describe('ConnectionCounter', () => {
  it('caps concurrent connections per address', () => {
    const counter = new ConnectionCounter(2);
    expect(counter.tryAdd('1.2.3.4')).toBe(true);
    expect(counter.tryAdd('1.2.3.4')).toBe(true);
    expect(counter.tryAdd('1.2.3.4')).toBe(false);
    expect(counter.get('1.2.3.4')).toBe(2);
  });

  it('frees a slot when a connection closes', () => {
    const counter = new ConnectionCounter(1);
    expect(counter.tryAdd('ip')).toBe(true);
    expect(counter.tryAdd('ip')).toBe(false);
    counter.remove('ip');
    expect(counter.tryAdd('ip')).toBe(true);
  });

  it('tracks addresses independently', () => {
    const counter = new ConnectionCounter(1);
    expect(counter.tryAdd('a')).toBe(true);
    expect(counter.tryAdd('b')).toBe(true);
    expect(counter.tryAdd('a')).toBe(false);
  });

  it('drops the entry entirely when the last connection goes', () => {
    const counter = new ConnectionCounter(3);
    counter.tryAdd('ip');
    counter.remove('ip');
    expect(counter.get('ip')).toBe(0);
  });
});
