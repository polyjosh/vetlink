import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../../context.js';
import { adminProfiles, authSessions, users } from '../../db/schema/index.js';
import { fieldContext } from '../../lib/crypto.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import { audit } from '../admin/audit.js';
import { ADMIN_2FA_TTL_MS, isRecent, type AuthContext } from './access.js';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

const MINUTE = 60 * 1000;
export const TWO_FACTOR_FAILURES_BEFORE_LOCK = { limit: 5, windowMs: 15 * MINUTE };
export const TWO_FACTOR_LOCK_MS = 15 * MINUTE;
export const RECOVERY_CODE_COUNT = 10;
/** How long a newly granted (or reset) admin has to enrol an authenticator. */
export const TOTP_ENROL_WINDOW_MS = 72 * 60 * MINUTE;
// A code is accepted for its own step and one either side, so remember it for three steps.
const TOTP_REPLAY_TTL_MS = 3 * 30 * 1000;

const keys = {
  lock: (userId: string) => `2fa:lock:${userId}`,
  failures: (userId: string) => `2fa:fail:${userId}`,
  used: (userId: string, step: number) => `2fa:used:${userId}:${step}`,
};

const totpContext = (userId: string) => fieldContext('admin_profiles.totp_secret', userId);

/** The caller's live admin profile. Anyone else gets "not found" (admin is not advertised). */
async function activeAdmin(ctx: AppContext, auth: AuthContext) {
  const [admin] = await ctx.db
    .select()
    .from(adminProfiles)
    .where(and(eq(adminProfiles.userId, auth.userId), isNull(adminProfiles.revokedAt)))
    .limit(1);
  if (!admin) throw new DomainError('not_found');
  return admin;
}

type AdminProfile = Awaited<ReturnType<typeof activeAdmin>>;

/**
 * Enrolment is open only to an admin without TOTP, before the deadline set when admin was
 * granted or 2FA was reset. Outside it, a stolen OTP alone cannot enrol a new authenticator.
 */
function assertEnrolmentOpen(admin: AdminProfile, now: Date): void {
  if (admin.totpEnabled) throw new DomainError('two_factor_already_enabled');
  if (!admin.totpEnrolExpiresAt || admin.totpEnrolExpiresAt <= now) {
    throw new DomainError('two_factor_enrolment_closed');
  }
}

/** `XXXXX-XXXXX` from the base32 alphabet (50 bits each). */
function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

async function recordFailure(
  ctx: AppContext,
  auth: AuthContext,
  log: FastifyBaseLogger,
  now: Date,
) {
  const failures = await ctx.counters.hit(
    keys.failures(auth.userId),
    TWO_FACTOR_FAILURES_BEFORE_LOCK.windowMs,
  );
  await audit(
    ctx.db,
    {
      actorUserId: auth.userId,
      action: 'admin.2fa_failed',
      entity: 'user',
      entityId: auth.userId,
      meta: { failures },
    },
    now,
  );
  // Failed admin 2FA is an alerting signal (§17): warn on every failure, error on lockout.
  log.warn({ userId: auth.userId, sessionId: auth.sessionId, failures }, 'admin 2FA failed');
  if (failures >= TWO_FACTOR_FAILURES_BEFORE_LOCK.limit) {
    await ctx.counters.claim(keys.lock(auth.userId), TWO_FACTOR_LOCK_MS);
    await audit(
      ctx.db,
      {
        actorUserId: auth.userId,
        action: 'admin.2fa_locked',
        entity: 'user',
        entityId: auth.userId,
      },
      now,
    );
    log.error({ userId: auth.userId }, 'admin 2FA locked after repeated failures');
  }
}

async function assertNotLocked(ctx: AppContext, auth: AuthContext) {
  if ((await ctx.counters.get(keys.lock(auth.userId))) > 0) {
    throw new DomainError('two_factor_locked');
  }
}

/** Verify a TOTP code once: a code that already worked cannot be replayed. */
async function checkTotp(
  ctx: AppContext,
  auth: AuthContext,
  secretEnc: string,
  code: string,
  log: FastifyBaseLogger,
  now: Date,
): Promise<void> {
  await assertNotLocked(ctx, auth);
  const secret = ctx.crypto.decrypt(secretEnc, totpContext(auth.userId));
  const step = verifyTotp(secret, code, now);
  const fresh =
    step !== null && (await ctx.counters.claim(keys.used(auth.userId, step), TOTP_REPLAY_TTL_MS));
  if (!fresh) {
    await recordFailure(ctx, auth, log, now);
    throw new DomainError('two_factor_invalid');
  }
  await ctx.counters.reset(keys.failures(auth.userId));
}

/** Start enrolment: a new secret for the authenticator app. Not allowed once enabled. */
export async function setupTwoFactor(ctx: AppContext, auth: AuthContext) {
  const admin = await activeAdmin(ctx, auth);
  const now = ctx.clock();
  assertEnrolmentOpen(admin, now);
  const secret = generateTotpSecret();
  await ctx.db
    .update(adminProfiles)
    .set({ totpSecretEnc: ctx.crypto.encrypt(secret, totpContext(auth.userId)) })
    .where(eq(adminProfiles.userId, auth.userId));
  const [user] = await ctx.db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, auth.userId));
  await audit(
    ctx.db,
    {
      actorUserId: auth.userId,
      action: 'admin.2fa_setup_started',
      entity: 'user',
      entityId: auth.userId,
    },
    now,
  );
  // The label shows in the authenticator app; a masked number is enough to recognise it.
  return { secret, otpauthUri: otpauthUri(secret, maskPhone(user?.phone ?? '')) };
}

/** Finish enrolment with a first code. Returns the recovery codes, shown once only. */
export async function enableTwoFactor(
  ctx: AppContext,
  auth: AuthContext,
  code: string,
  log: FastifyBaseLogger,
) {
  const admin = await activeAdmin(ctx, auth);
  const now = ctx.clock();
  assertEnrolmentOpen(admin, now);
  if (!admin.totpSecretEnc) throw new DomainError('two_factor_setup_required');
  await checkTotp(ctx, auth, admin.totpSecretEnc, code, log, now);

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const enabled = await ctx.db.transaction(async (tx) => {
    // Conditional on still being unenrolled, so two concurrent enables cannot both succeed.
    const updated = await tx
      .update(adminProfiles)
      .set({
        totpEnabled: true,
        totpEnrolExpiresAt: null, // enrolment closes once used
        recoveryCodesHash: recoveryCodes.map((c) => ctx.hashRecoveryCode(normalizeRecoveryCode(c))),
      })
      .where(and(eq(adminProfiles.userId, auth.userId), eq(adminProfiles.totpEnabled, false)))
      .returning({ userId: adminProfiles.userId });
    if (updated.length === 0) return false;
    // Enrolling proves possession of the authenticator, so this session is verified.
    await tx
      .update(authSessions)
      .set({ mfaVerifiedAt: now })
      .where(eq(authSessions.id, auth.sessionId));
    return true;
  });
  if (!enabled) throw new DomainError('two_factor_already_enabled');
  await audit(
    ctx.db,
    {
      actorUserId: auth.userId,
      action: 'admin.2fa_enabled',
      entity: 'user',
      entityId: auth.userId,
    },
    now,
  );
  return { recoveryCodes };
}

/** Satisfy admin 2FA on this session with a TOTP code or a one-time recovery code. */
export async function verifyTwoFactor(
  ctx: AppContext,
  auth: AuthContext,
  input: { code: string } | { recoveryCode: string },
  log: FastifyBaseLogger,
): Promise<void> {
  const admin = await activeAdmin(ctx, auth);
  if (!admin.totpEnabled || !admin.totpSecretEnc)
    throw new DomainError('two_factor_setup_required');
  const now = ctx.clock();
  let method: 'totp' | 'recovery_code';
  if ('code' in input) {
    await checkTotp(ctx, auth, admin.totpSecretEnc, input.code, log, now);
    method = 'totp';
  } else {
    await assertNotLocked(ctx, auth);
    const hash = ctx.hashRecoveryCode(normalizeRecoveryCode(input.recoveryCode));
    // Remove the code in the same statement that checks it, so it works exactly once.
    const used = await ctx.db
      .update(adminProfiles)
      .set({ recoveryCodesHash: sql`array_remove(${adminProfiles.recoveryCodesHash}, ${hash})` })
      .where(
        and(
          eq(adminProfiles.userId, auth.userId),
          sql`${hash} = any(${adminProfiles.recoveryCodesHash})`,
        ),
      )
      .returning({ remaining: adminProfiles.recoveryCodesHash });
    if (used.length === 0) {
      await recordFailure(ctx, auth, log, now);
      throw new DomainError('two_factor_invalid');
    }
    await ctx.counters.reset(keys.failures(auth.userId));
    method = 'recovery_code';
  }
  await ctx.db
    .update(authSessions)
    .set({ mfaVerifiedAt: now })
    .where(eq(authSessions.id, auth.sessionId));
  await audit(
    ctx.db,
    {
      actorUserId: auth.userId,
      action: 'admin.2fa_verified',
      entity: 'user',
      entityId: auth.userId,
      meta: { method },
    },
    now,
  );
}

/** Fresh TOTP for a sensitive admin action (refunds, role grants, suspensions, config). */
export async function stepUp(
  ctx: AppContext,
  auth: AuthContext,
  code: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const admin = await activeAdmin(ctx, auth);
  if (!admin.totpEnabled || !admin.totpSecretEnc)
    throw new DomainError('two_factor_setup_required');
  const now = ctx.clock();
  if (!isRecent(auth.admin?.mfaVerifiedAt ?? null, ADMIN_2FA_TTL_MS, now)) {
    throw new DomainError('two_factor_required');
  }
  await checkTotp(ctx, auth, admin.totpSecretEnc, code, log, now);
  await ctx.db
    .update(authSessions)
    .set({ stepUpAt: now })
    .where(eq(authSessions.id, auth.sessionId));
  await audit(
    ctx.db,
    { actorUserId: auth.userId, action: 'admin.step_up', entity: 'user', entityId: auth.userId },
    now,
  );
}

/**
 * A super admin resets another admin's 2FA (lost phone, lost recovery codes): the old
 * authenticator and recovery codes stop working, the target's sessions lose 2FA, and a new
 * enrolment window opens. Self-reset is refused, so recovery always involves a second person.
 */
export async function resetTwoFactor(
  ctx: AppContext,
  actor: AuthContext,
  targetUserId: string,
  log: FastifyBaseLogger,
): Promise<{ enrolExpiresAt: Date }> {
  if (targetUserId === actor.userId) throw new DomainError('forbidden');
  const now = ctx.clock();
  const enrolExpiresAt = new Date(now.getTime() + TOTP_ENROL_WINDOW_MS);
  const reset = await ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(adminProfiles)
      .set({
        totpSecretEnc: null,
        totpEnabled: false,
        recoveryCodesHash: null,
        totpEnrolExpiresAt: enrolExpiresAt,
      })
      .where(and(eq(adminProfiles.userId, targetUserId), isNull(adminProfiles.revokedAt)))
      .returning({ userId: adminProfiles.userId });
    if (updated.length === 0) return false;
    await tx
      .update(authSessions)
      .set({ mfaVerifiedAt: null, stepUpAt: null })
      .where(and(eq(authSessions.userId, targetUserId), isNull(authSessions.revokedAt)));
    return true;
  });
  if (!reset) throw new DomainError('not_found');
  await ctx.counters.reset(keys.lock(targetUserId));
  await ctx.counters.reset(keys.failures(targetUserId));
  await audit(
    ctx.db,
    {
      actorUserId: actor.userId,
      action: 'admin.2fa_reset',
      entity: 'user',
      entityId: targetUserId,
      meta: { enrolExpiresAt: enrolExpiresAt.toISOString() },
    },
    now,
  );
  log.warn({ actorUserId: actor.userId, targetUserId }, 'admin 2FA reset');
  return { enrolExpiresAt };
}
