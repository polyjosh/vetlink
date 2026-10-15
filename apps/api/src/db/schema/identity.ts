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
} from 'drizzle-orm/pg-core';
import { DEFAULT_LOCALE, LOCALES } from '@vetlink/i18n';
import { ADMIN_ROLES, DEVICE_PLATFORMS, USER_ROLES } from '@vetlink/shared';
import { createdAt, emptyTextArray, oneOf, subsetOf, timestamptz } from './helpers.js';

/** The phone number is the account (invariant 1). Farmer and vet are profiles on top. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull().unique(), // 2547XXXXXXXX
    name: text('name'),
    language: text('language', { enum: LOCALES }).notNull().default(DEFAULT_LOCALE),
    roles: text('roles', { enum: USER_ROLES }).array().notNull().default(emptyTextArray),
    consentAt: timestamptz('consent_at'),
    createdAt: createdAt(),
    deletedAt: timestamptz('deleted_at'), // soft delete → anonymize job
  },
  (t) => [
    check('users_phone_check', sql`${t.phone} ~ '^254[17][0-9]{8}$'`),
    check('users_language_check', oneOf(t.language, LOCALES)),
    check('users_roles_check', subsetOf(t.roles, USER_ROLES)),
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

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    deviceId: uuid('device_id').references(() => devices.id),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
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
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [check('admin_profiles_admin_role_check', oneOf(t.adminRole, ADMIN_ROLES))],
);
