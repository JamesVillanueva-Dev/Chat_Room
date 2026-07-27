import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const validate = require('../../src/lib/validate');

describe('username validation', () => {
  it('accepts ordinary names', () => {
    expect(validate.username('alice')).toBe('alice');
    expect(validate.username('  bob_smith  ')).toBe('bob_smith');
    expect(validate.username('a.b-c')).toBe('a.b-c');
  });

  it('rejects names that are too short or too long', () => {
    expect(() => validate.username('ab')).toThrow(/at least/);
    expect(() => validate.username('x'.repeat(25))).toThrow(/at most/);
  });

  it('rejects punctuation at the edges and unsupported characters', () => {
    expect(() => validate.username('_leading')).toThrow();
    expect(() => validate.username('trailing.')).toThrow();
    expect(() => validate.username('has space')).toThrow();
    expect(() => validate.username('emoji😀name')).toThrow();
  });

  it('rejects names that would impersonate the server', () => {
    for (const name of ['system', 'admin', 'RPS-Bot', 'everyone', 'moderator']) {
      expect(() => validate.username(name), `${name} should be reserved`).toThrow(/reserved/);
    }
  });

  it('rejects a non-string', () => {
    expect(() => validate.username(undefined)).toThrow();
    expect(() => validate.username(42)).toThrow();
  });
});

describe('password validation', () => {
  it('requires a minimum length', () => {
    expect(() => validate.password('short')).toThrow(/at least/);
    expect(validate.password('longenough1')).toBe('longenough1');
  });

  it('rejects passwords past bcrypt 72-byte truncation point', () => {
    expect(() => validate.password('a'.repeat(73))).toThrow(/72 bytes/);
    // Multi-byte characters count as bytes, not characters.
    expect(() => validate.password('é'.repeat(40))).toThrow(/72 bytes/);
  });
});

describe('message body validation', () => {
  it('trims and keeps intentional line breaks', () => {
    expect(validate.messageBody('  hello\nworld  ')).toBe('hello\nworld');
  });

  it('collapses runs of blank lines', () => {
    expect(validate.messageBody('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('normalises Windows line endings', () => {
    expect(validate.messageBody('a\r\nb')).toBe('a\nb');
  });

  it('rejects an empty message unless explicitly allowed', () => {
    expect(() => validate.messageBody('   ')).toThrow(/empty/);
    expect(validate.messageBody('   ', { allowEmpty: true })).toBe('');
  });

  it('rejects a message past the length limit', () => {
    expect(() => validate.messageBody('x'.repeat(5000))).toThrow(/at most/);
  });
});

describe('emoji validation', () => {
  it('accepts real emoji including compound ones', () => {
    expect(validate.emoji('👍')).toBe('👍');
    expect(validate.emoji('❤️')).toBe('❤️');
    expect(validate.emoji('🇬🇧')).toBe('🇬🇧');
  });

  it('rejects text pretending to be a reaction', () => {
    expect(() => validate.emoji('lol')).toThrow(/emoji/);
    expect(() => validate.emoji('')).toThrow();
    expect(() => validate.emoji('👍'.repeat(20))).toThrow();
    expect(() => validate.emoji('<script>')).toThrow();
  });
});

describe('other validators', () => {
  it('bounds free text and collapses whitespace', () => {
    expect(validate.boundedText('  a   b  ', { field: 'topic', max: 20 })).toBe('a b');
    expect(() => validate.boundedText('x'.repeat(30), { field: 'topic', max: 20 })).toThrow(/at most/);
    expect(validate.boundedText(undefined, { field: 'topic', max: 20 })).toBe('');
  });

  it('requires a room name to contain something meaningful', () => {
    expect(validate.roomName('Project X')).toBe('Project X');
    expect(() => validate.roomName('!')).toThrow();
    expect(() => validate.roomName('a')).toThrow(/at least/);
  });

  it('restricts presence and visibility to known values', () => {
    expect(validate.presence('busy')).toBe('busy');
    expect(() => validate.presence('sleeping')).toThrow();
    expect(validate.visibility('private')).toBe('private');
    expect(() => validate.visibility('secret')).toThrow();
  });

  it('parses positive integers and rejects junk', () => {
    expect(validate.positiveInt('42', 'id')).toBe(42);
    expect(validate.positiveInt(7, 'id')).toBe(7);
    expect(() => validate.positiveInt('0', 'id')).toThrow();
    expect(() => validate.positiveInt('-3', 'id')).toThrow();
    expect(() => validate.positiveInt('abc', 'id')).toThrow();
    expect(validate.positiveInt('9999', 'limit', { max: 100 })).toBe(100);
  });

  it('treats blank optional ids as absent', () => {
    expect(validate.optionalId('', 'before')).toBeNull();
    expect(validate.optionalId(undefined, 'before')).toBeNull();
    expect(validate.optionalId('12', 'before')).toBe(12);
  });
});
