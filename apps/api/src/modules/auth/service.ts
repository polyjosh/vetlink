import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { DEFAULT_LOCALE, interpolate, messages } from '@vetlink/i18n';
import { normalizePhone, type DevicePlatform, type SessionRole } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import {
  adminProfiles,
  authSessions,
  devices,
  otpCodes,
  refreshTokens,
  users,
} from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import { sessionRoles } from './access.js';
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_MS, newRefreshToken, sha256 } from './tokens.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const OTP_TTL_MS = 5 * MINUTE;
/** Wrong guesses allowed on one code before it is burned. */
export const OTP_MAX_ATTEMPTS = 5;
/** OTP SMS per phone per window (each SMS costs money and can be used to harass a number). */
export const OTP_REQUESTS_PER_PHONE = { limit: 3, windowMs: 10 * MINUTE };
/** Generous: many farmers share a carrier NAT address. */
export const OTP_REQUESTS_PER_IP = { limit: 30, windowMs: HOUR };
/** Wrong codes per phone (across codes) before the phone is locked. */
export const OTP_FAILURES_BEFORE_LOCK = { limit: 10, windowMs: HOUR };
export const OTP_LOCK_MS = HOUR;
/**
 * A rotated refresh token still works this long, for clients that retry after losing the
 * response on a bad connection. After that, presenting it is treated as theft.
 */
export const REFRESH_REUSE_GRACE_MS = MINUTE;

const keys = {
  lock: (phone: string) => `otp:lock:${phone}`,
  failures: (phone: string) => `otp:fail:${phone}`,
  perPhone: (phone: string) => `otp:req:phone:${phone}`,
  perIp: (ip: string) => `otp:req:ip:${ip}`,
};

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

function requirePhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone) throw new DomainError('invalid_phone');
  return phone;
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

async function assertNotLocked(ctx: AppContext, phone: string): Promise<void> {
  if ((await ctx.counters.get(keys.lock(phone))) > 0) throw new DomainError('account_locked');
}

/** Send a login code. Same response whether or not the number has an account. */
export async function requestOtp(
  ctx: AppContext,
  input: { phone: string; ip: string },
  log: FastifyBaseLogger,
): Promise<{ expiresInSeconds: number }> {
  const phone = requirePhone(input.phone);
  await assertNotLocked(ctx, phone);
  if (
    (await ctx.counters.hit(keys.perIp(input.ip), OTP_REQUESTS_PER_IP.windowMs)) >
    OTP_REQUESTS_PER_IP.limit
  ) {
    throw new DomainError('rate_limited');
  }
  if (
    (await ctx.counters.hit(keys.perPhone(phone), OTP_REQUESTS_PER_PHONE.windowMs)) >
    OTP_REQUESTS_PER_PHONE.limit
  ) {
    throw new DomainError('rate_limited');
  }

  const code = ctx.otpFixedCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = ctx.clock();
  await ctx.db.transaction(async (tx) => {
    // A new code supersedes any earlier one.
    await tx
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)));
    await tx.insert(otpCodes).values({
      phone,
      codeHash: ctx.hashOtp(`${phone}:${code}`),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    });
  });

  const [user] = await ctx.db
    .select({ language: users.language })
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  const text = interpolate(messages[user?.language ?? DEFAULT_LOCALE].sms.otp, {
    code,
    minutes: OTP_TTL_MS / MINUTE,
  });
  try {
    await ctx.sms.send(phone, text);
  } catch (err) {
    log.error({ err, phone: maskPhone(phone) }, 'OTP SMS failed');
    throw new DomainError('sms_unavailable');
  }
  return { expiresInSeconds: OTP_TTL_MS / 1000 };
}

async function recordOtpFailure(
  ctx: AppContext,
  phone: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const failures = await ctx.counters.hit(keys.failures(phone), OTP_FAILURES_BEFORE_LOCK.windowMs);
  if (failures >= OTP_FAILURES_BEFORE_LOCK.limit) {
    await ctx.counters.claim(keys.lock(phone), OTP_LOCK_MS);
    log.warn({ phone: maskPhone(phone), failures }, 'OTP lockout');
  }
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
  device: { platform: DevicePlatform; appVersion?: string | undefined };
}

/** Check a login code, then sign in (creating the account on first login). */
export async function verifyOtp(
  ctx: AppContext,
  input: VerifyOtpInput,
  log: FastifyBaseLogger,
): Promise<IssuedTokens & { isNewUser: boolean }> {
  const phone = requirePhone(input.phone);
  await assertNotLocked(ctx, phone);
  const now = ctx.clock();

  const [otp] = await ctx.db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.id))
    .limit(1);
  if (!otp) {
    await recordOtpFailure(ctx, phone, log);
    throw new DomainError('otp_invalid');
  }
  if (otp.expiresAt <= now) throw new DomainError('otp_expired');

  if (!sameHash(ctx.hashOtp(`${phone}:${input.code}`), otp.codeHash)) {
    await ctx.db
      .update(otpCodes)
      .set({
        attempts: sql`${otpCodes.attempts} + 1`,
        // Burn the code on the last allowed attempt.
        consumedAt: sql`case when ${otpCodes.attempts} + 1 >= ${OTP_MAX_ATTEMPTS} then ${now.toISOString()}::timestamptz else null end`,
      })
      .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)));
    await recordOtpFailure(ctx, phone, log);
    throw new DomainError('otp_invalid');
  }

  // Consume exactly once: of two concurrent correct submissions, only one updates the row.
  const consumed = await ctx.db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (consumed.length === 0) throw new DomainError('otp_invalid');
  await ctx.counters.reset(keys.failures(phone));

  const { userId, isNewUser, sessionId, refreshToken } = await ctx.db.transaction(async (tx) => {
    const created = await tx
      .insert(users)
      .values({ phone, createdAt: now })
      .onConflictDoNothing({ target: users.phone, where: sql`${users.deletedAt} is null` })
      .returning({ id: users.id });
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new Error('user missing after upsert');
    const [device] = await tx
      .insert(devices)
      .values({
        userId: user.id,
        platform: input.device.platform,
        appVersion: input.device.appVersion ?? null,
        lastSeenAt: now,
      })
      .returning({ id: devices.id });
    const [session] = await tx
      .insert(authSessions)
      .values({ userId: user.id, deviceId: device?.id ?? null, createdAt: now })
      .returning({ id: authSessions.id });
    if (!session) throw new Error('session insert failed');
    const token = newRefreshToken();
    await tx.insert(refreshTokens).values({
      userId: user.id,
      sessionId: session.id,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      createdAt: now,
    });
    return {
      userId: user.id,
      isNewUser: created.length > 0,
      sessionId: session.id,
      refreshToken: token,
    };
  });

  log.info({ userId, sessionId, isNewUser }, 'signed in');
  return { ...(await signAccess(ctx, userId, sessionId, refreshToken)), isNewUser };
}

export async function currentSessionRoles(db: Db, userId: string): Promise<SessionRole[]> {
  const [row] = await db
    .select({
      roles: users.roles,
      adminRevokedAt: adminProfiles.revokedAt,
      admin: adminProfiles.userId,
    })
    .from(users)
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return [];
  return sessionRoles(row.roles, row.admin !== null && row.adminRevokedAt === null);
}

async function signAccess(
  ctx: AppContext,
  userId: string,
  sessionId: string,
  refreshToken: string,
): Promise<IssuedTokens> {
  const roles = await currentSessionRoles(ctx.db, userId);
  return {
    accessToken: await ctx.tokens.sign({ userId, sessionId, roles }, ctx.clock()),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_S,
    refreshToken,
  };
}

/**
 * Rotate a refresh token. Each session has one live token; the presented one is replaced.
 * Presenting an already-rotated token after the grace window revokes the whole session.
 */
export async function refresh(
  ctx: AppContext,
  presented: string,
  log: FastifyBaseLogger,
): Promise<IssuedTokens> {
  const now = ctx.clock();
  const result = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        sessionId: refreshTokens.sessionId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        sessionRevokedAt: authSessions.revokedAt,
        deviceId: authSessions.deviceId,
        userDeletedAt: users.deletedAt,
      })
      .from(refreshTokens)
      .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(eq(refreshTokens.tokenHash, sha256(presented)))
      .limit(1)
      // Serializes concurrent refreshes of the same session.
      .for('update');
    if (!row || row.sessionRevokedAt || row.userDeletedAt || row.expiresAt <= now) {
      return { kind: 'invalid' } as const;
    }
    if (row.revokedAt && now.getTime() - row.revokedAt.getTime() >= REFRESH_REUSE_GRACE_MS) {
      await tx
        .update(authSessions)
        .set({ revokedAt: now, revokedReason: 'refresh_token_reuse' })
        .where(eq(authSessions.id, row.sessionId));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.sessionId, row.sessionId), isNull(refreshTokens.revokedAt)));
      return { kind: 'reuse', userId: row.userId, sessionId: row.sessionId } as const;
    }

    const token = newRefreshToken();
    const newId = randomUUID();
    await tx.insert(refreshTokens).values({
      id: newId,
      userId: row.userId,
      sessionId: row.sessionId,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      createdAt: now,
    });
    // Retire the presented token and any other live token of this session (in the grace case,
    // the successor the client never received). A rotated token keeps its original revoked_at,
    // so the grace window never extends.
    await tx
      .update(refreshTokens)
      .set({
        revokedAt: sql`coalesce(${refreshTokens.revokedAt}, ${now.toISOString()}::timestamptz)`,
        replacedById: newId,
      })
      .where(
        and(
          eq(refreshTokens.sessionId, row.sessionId),
          ne(refreshTokens.id, newId),
          or(isNull(refreshTokens.revokedAt), eq(refreshTokens.id, row.id)),
        ),
      );
    if (row.deviceId) {
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.deviceId));
    }
    return { kind: 'ok', userId: row.userId, sessionId: row.sessionId, token } as const;
  });

  if (result.kind === 'invalid') throw new DomainError('refresh_invalid');
  if (result.kind === 'reuse') {
    log.warn(
      { userId: result.userId, sessionId: result.sessionId },
      'refresh token reuse detected; session revoked',
    );
    throw new DomainError('refresh_invalid');
  }
  return signAccess(ctx, result.userId, result.sessionId, result.token);
}

/** End this session everywhere: its refresh tokens stop working and access tokens are refused. */
export async function logout(ctx: AppContext, sessionId: string): Promise<void> {
  const now = ctx.clock();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: 'logout' })
      .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)));
  });
}
