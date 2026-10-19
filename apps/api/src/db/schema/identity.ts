import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { DEFAULT_LOCALE, LOCALES } from '@vetlink/i18n';
import {
  ADMIN_ROLES,
  DEVICE_PLATFORMS,
  SESSION_REVOKED_REASONS,
  THEMES,
  USER_ROLES,
} from '@vetlink/shared';
import { createdAt, emptyTextArray, oneOf, subsetOf, timestamptz } from './helpers.js';
import { media } from './bookings.js';

/** The phone number is the account (invariant 1). Farmer and vet are profiles on top. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 2547XXXXXXXX. NULL only after deletion, when the anonymize job clears it (§17).
    phone: text('phone'),
    name: text('name'),
    displayName: text('display_name'), // §24.1: shown to others, never a login
    // The live profile photo. A vet's new photo waits in vets.pending_avatar_media_id.
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id),
    language: text('language', { enum: LOCALES }).notNull().default(DEFAULT_LOCALE),
    theme: text('theme', { enum: THEMES }).notNull().default('system'),
    roles: text('roles', { enum: USER_ROLES }).array().notNull().default(emptyTextArray),
    consentAt: timestamptz('consent_at'),
    createdAt: createdAt(),
    deletedAt: timestamptz('deleted_at'), // soft delete → anonymize job
  },
  (t) => [
    // Active users need a valid phone; deleted users may have it cleared. coalesce() because a
    // NULL check result would otherwise pass.
    check(
      'users_phone_check',
      sql`(${t.phone} is null and ${t.deletedAt} is not null) or coalesce(${t.phone} ~ '^254[17][0-9]{8}$', false)`,
    ),
    // One active account per phone; a deleted account awaiting anonymization does not block
    // the same number signing up again.
    uniqueIndex('users_phone_active_key')
      .on(t.phone)
      .where(sql`${t.deletedAt} is null`),
    check('users_language_check', oneOf(t.language, LOCALES)),
    check('users_roles_check', subsetOf(t.roles, USER_ROLES)),
    check('users_theme_check', oneOf(t.theme, THEMES)),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: serial('id').primaryKey(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(), // never store plain OTPs
    expiresAt: timestamptz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamptz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_phone_expires_at_idx').on(t.phone, t.expiresAt)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    platform: text('platform', { enum: DEVICE_PLATFORMS }).notNull(),
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    lastSeenAt: timestamptz('last_seen_at'),
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  },
  (t) => [
    check('devices_platform_check', oneOf(t.platform, DEVICE_PLATFORMS)),
    index('devices_user_id_idx').on(t.userId),
  ],
);

/**
 * One login on one device. Refresh tokens rotate within a session; logout or refresh-token reuse
 * revokes the whole session. Admin 2FA and step-up state live here, never in the client.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    createdAt: createdAt(),
    revokedAt: timestamptz('revoked_at'),
    revokedReason: text('revoked_reason', { enum: SESSION_REVOKED_REASONS }),
    mfaVerifiedAt: timestamptz('mfa_verified_at'), // admin TOTP satisfied on this session
    stepUpAt: timestamptz('step_up_at'), // fresh TOTP for sensitive admin actions
  },
  (t) => [
    check('auth_sessions_revoked_reason_check', oneOf(t.revokedReason, SESSION_REVOKED_REASONS)),
    index('auth_sessions_user_id_idx').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => authSessions.id),
    tokenHash: text('token_hash').notNull(), // SHA-256 of a random 256-bit token
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    // Set when rotated; presenting a rotated token outside the grace window revokes the session.
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_session_id_idx').on(t.sessionId),
  ],
);

/** Admin access is granted only by a super admin (or the dev seed); never via self-signup. */
export const adminProfiles = pgTable(
  'admin_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    adminRole: text('admin_role', { enum: ADMIN_ROLES }).notNull(),
    totpSecretEnc: text('totp_secret_enc'), // AES-256-GCM, see lib/crypto.ts
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    recoveryCodesHash: text('recovery_codes_hash').array(),
    // TOTP can be enrolled only before this time. Set when admin is granted (M10) or when a
    // super admin resets 2FA; NULL means no enrolment is open. Limits the window in which
    // control of the phone (OTP) alone is enough to enrol an authenticator.
    totpEnrolExpiresAt: timestamptz('totp_enrol_expires_at'),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [check('admin_profiles_admin_role_check', oneOf(t.adminRole, ADMIN_ROLES))],
);
