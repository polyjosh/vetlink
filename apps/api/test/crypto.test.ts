import { describe, expect, it } from 'vitest';
import { fieldCrypto, parseMasterKey } from '../src/lib/crypto.js';

const key = Buffer.alloc(32, 1).toString('base64');
const otherKey = Buffer.alloc(32, 2).toString('base64');

describe('fieldCrypto', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const c = fieldCrypto(key);
    const a = c.encrypt('12345678');
    const b = c.encrypt('12345678');
    expect(a).not.toBe(b);
    expect(a).not.toContain('12345678');
    expect(c.decrypt(a)).toBe('12345678');
    expect(c.decrypt(b)).toBe('12345678');
  });

  it('rejects tampered ciphertext', () => {
    const c = fieldCrypto(key);
    const [v, iv, tag, ct] = c.encrypt('12345678').split('.') as [string, string, string, string];
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => c.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => c.decrypt('not-encrypted')).toThrow(/Unrecognized/);
  });

  it('cannot decrypt under a different key', () => {
    const token = fieldCrypto(key).encrypt('12345678');
    expect(() => fieldCrypto(otherKey).decrypt(token)).toThrow();
  });

  it('lookupHash is deterministic, keyed, and not a plain hash', () => {
    const c = fieldCrypto(key);
    expect(c.lookupHash('12345678')).toBe(c.lookupHash('12345678'));
    expect(c.lookupHash('12345678')).not.toBe(c.lookupHash('12345679'));
    expect(fieldCrypto(otherKey).lookupHash('12345678')).not.toBe(c.lookupHash('12345678'));
  });
});

describe('parseMasterKey', () => {
  it.each([
    ['16 bytes', Buffer.alloc(16).toString('base64')],
    ['33 bytes', Buffer.alloc(33).toString('base64')],
    ['not base64', 'this is not base64 at all, nope!!!!!!!!!!!!'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => parseMasterKey(value)).toThrow(/32 bytes/);
  });

  it('accepts 32 bytes of base64', () => {
    expect(parseMasterKey(key)).toHaveLength(32);
  });
});
