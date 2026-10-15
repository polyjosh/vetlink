import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpStep,
  verifyTotp,
} from '../src/modules/auth/totp.js';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (RFC 4226 / RFC 6238)', () => {
  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(RFC_KEY, counter)).toBe(code));
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 SHA-1 vector at T=%i', (seconds, code) => {
    expect(hotp(RFC_KEY, totpStep(new Date(seconds * 1000)), 8)).toBe(code);
  });

  it('round-trips base32 and generates 160-bit secrets', () => {
    expect(base32Decode(base32Encode(RFC_KEY)).equals(RFC_KEY)).toBe(true);
    expect(base32Encode(RFC_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('accepts the current step and one step of drift either side, and returns the step', () => {
    const secret = base32Encode(RFC_KEY);
    const now = new Date(1_800_000_000_000);
    const step = totpStep(now);
    expect(verifyTotp(secret, hotp(RFC_KEY, step), now)).toBe(step);
    expect(verifyTotp(secret, hotp(RFC_KEY, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(RFC_KEY, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(RFC_KEY, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('builds an otpauth URI an authenticator app can scan', () => {
    const uri = otpauthUri('ABC', '2547****123');
    expect(uri).toMatch(/^otpauth:\/\/totp\/VetLink%3A2547\*\*\*\*123\?/);
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('issuer=VetLink');
  });
});
