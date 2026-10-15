import { describe, expect, it } from 'vitest';
import { fieldContext, fieldCrypto, parseMasterKey } from '../src/lib/crypto.js';

const key = Buffer.alloc(32, 1).toString('base64');
const otherKey = Buffer.alloc(32, 2).toString('base64');
const ctx = fieldContext('vets.national_id', 'user-a');

describe('fieldCrypto', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const c = fieldCrypto(key);
    const a = c.encrypt('12345678', ctx);
    const b = c.encrypt('12345678', ctx);
    expect(a).not.toBe(b);
    expect(a).not.toContain('12345678');
    expect(c.decrypt(a, ctx)).toBe('12345678');
    expect(c.decrypt(b, ctx)).toBe('12345678');
  });

  it('rejects tampered ciphertext', () => {
    const c = fieldCrypto(key);
    const [v, iv, tag, ct] = c.encrypt('12345678', ctx).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => c.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), ctx)).toThrow();
    expect(() => c.decrypt('not-encrypted', ctx)).toThrow(/Unrecognized/);
  });

  it('rejects a value moved to another row or column', () => {
    const c = fieldCrypto(key);
    const token = c.encrypt('12345678', ctx);
    expect(() => c.decrypt(token, fieldContext('vets.national_id', 'user-b'))).toThrow();
    expect(() => c.decrypt(token, fieldContext('admin_profiles.totp_secret', 'user-a'))).toThrow();
  });

  it('cannot decrypt under a different key', () => {
    const token = fieldCrypto(key).encrypt('12345678', ctx);
    expect(() => fieldCrypto(otherKey).decrypt(token, ctx)).toThrow();
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
