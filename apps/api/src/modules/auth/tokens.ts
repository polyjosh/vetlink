import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { SESSION_ROLES, type SessionRole } from '@vetlink/shared';
import { z } from 'zod';

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ISSUER = 'vetlink-api';
const AUDIENCE = 'vetlink';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  /** Convenience for clients only. Guards always re-check roles against the database. */
  roles: SessionRole[];
}

const payloadSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  roles: z.array(z.enum(SESSION_ROLES)),
});

export interface AccessTokens {
  sign(claims: AccessClaims, now: Date): Promise<string>;
  /** Returns null for any invalid, expired, or foreign token. */
  verify(token: string, now: Date): Promise<AccessClaims | null>;
}

export function accessTokens(secret: string): AccessTokens {
  const key = new TextEncoder().encode(secret);
  return {
    sign({ userId, sessionId, roles }, now) {
      const iat = Math.floor(now.getTime() / 1000);
      return new SignJWT({ sid: sessionId, roles })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TOKEN_TTL_S)
        .sign(key);
    },
    async verify(token, now) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          currentDate: now,
        });
        const parsed = payloadSchema.safeParse(payload);
        if (!parsed.success) return null;
        return { userId: parsed.data.sub, sessionId: parsed.data.sid, roles: parsed.data.roles };
      } catch (err) {
        if (err instanceof joseErrors.JOSEError) return null;
        throw err;
      }
    },
  };
}

/** A new opaque refresh token (256 bits). Only its SHA-256 is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Unkeyed SHA-256 is enough here: the input is 256 random bits, not guessable. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
