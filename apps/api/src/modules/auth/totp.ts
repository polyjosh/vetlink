import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP with the parameters every authenticator app supports: HMAC-SHA1, 6 digits,
// 30-second steps. Small enough to own instead of adding a dependency; tested against the
// RFC test vectors.
const STEP_S = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (RFC 4226 recommends 160), base32 for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_S);
}

/** HOTP (RFC 4226) for a counter. `digits` exists for the RFC 8-digit test vectors. */
export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

/**
 * Check a code against the current step and one step either side (clock drift).
 * Returns the matching step, so the caller can block reuse of that step; null if no match.
 */
export function verifyTotp(secretBase32: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const current = totpStep(now);
  let matched: number | null = null;
  // Check every candidate (no early exit) to keep timing independent of which step matched.
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) matched = step;
  }
  return matched;
}

/** `otpauth://` URI for the authenticator app's QR code. */
export function otpauthUri(secretBase32: string, accountLabel: string): string {
  const label = encodeURIComponent(`VetLink:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: 'VetLink',
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
