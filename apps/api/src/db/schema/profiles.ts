import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  APPLICATION_CREATED_VIA,
  APPLICATION_STATUSES,
  PRACTICE_TYPES,
  VERIFICATION_STATUSES,
  VET_DOCUMENT_KINDS,
  VET_DOCUMENT_STATUSES,
  VET_TYPES,
} from '@vetlink/shared';
import { emptyJson, emptyTextArray, oneOf, timestamptz } from './helpers.js';
import { users } from './identity.js';
import { locations } from './reference.js';

export const farmers = pgTable('farmers', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  wardId: integer('ward_id').references(() => locations.id),
  // Precise coordinates only when the farmer provides them (§17); ward-level otherwise.
  farmLat: doublePrecision('farm_lat'),
  farmLng: doublePrecision('farm_lng'),
  farmNotes: text('farm_notes'), // landmarks, gate colour, etc.
});

export const vets = pgTable(
  'vets',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    type: text('type', { enum: VET_TYPES }).notNull(),
    kvbRegNo: text('kvb_reg_no'),
    kvbCategory: text('kvb_category'),
    licenceExpiry: date('licence_expiry'),
    nationalIdEnc: text('national_id_enc'), // AES-256-GCM, see lib/crypto.ts
    nationalIdHash: text('national_id_hash'), // keyed HMAC, duplicate detection only
    qualification: text('qualification'),
    qualificationInstitution: text('qualification_institution'),
    qualificationYear: integer('qualification_year'),
    practiceType: text('practice_type', { enum: PRACTICE_TYPES }),
    practiceName: text('practice_name'),
    yearsExperience: integer('years_experience'),
    services: text('services').array().notNull().default(emptyTextArray),
    languages: text('languages').array().notNull().default(emptyTextArray),
    bio: text('bio'),
    payoutMpesaPhone: text('payout_mpesa_phone'),
    // Only `approved` vets receive offers (invariant 2), enforced in services, not here.
    verificationStatus: text('verification_status', { enum: VERIFICATION_STATUSES })
      .notNull()
      .default('draft'),
    verifiedAt: timestamptz('verified_at'),
    specialties: text('specialties').array().notNull().default(emptyTextArray), // species treated
    wardId: integer('ward_id').references(() => locations.id),
    serviceRadiusKm: integer('service_radius_km').notNull().default(20),
    baseCallOutFee: integer('base_call_out_fee'), // KES, integer
    rating: numeric('rating', { precision: 2, scale: 1 }),
    isAvailable: boolean('is_available').notNull().default(false),
    shareLiveLocation: boolean('share_live_location').notNull().default(false),
    liveLat: doublePrecision('live_lat'),
    liveLng: doublePrecision('live_lng'),
    liveLocationAt: timestamptz('live_location_at'),
  },
  (t) => [
    check('vets_type_check', oneOf(t.type, VET_TYPES)),
    check('vets_practice_type_check', oneOf(t.practiceType, PRACTICE_TYPES)),
    check('vets_verification_status_check', oneOf(t.verificationStatus, VERIFICATION_STATUSES)),
    // Invariant 2 at the database level: only an approved vet can be online. Suspending or
    // un-approving a vet must take them offline in the same statement.
    check(
      'vets_available_requires_approved',
      sql`not ${t.isAvailable} or ${t.verificationStatus} = 'approved'`,
    ),
    check('vets_base_call_out_fee_check', sql`${t.baseCallOutFee} >= 0`),
    check('vets_rating_check', sql`${t.rating} between 1 and 5`),
    index('vets_national_id_hash_idx').on(t.nationalIdHash), // duplicate-ID detection
    index('vets_ward_id_approved_available_idx')
      .on(t.wardId)
      .where(sql`${t.verificationStatus} = 'approved' and ${t.isAvailable}`),
  ],
);

export const vetApplications = pgTable(
  'vet_applications',
  {
    id: serial('id').primaryKey(),
    vetUserId: uuid('vet_user_id')
      .notNull()
      .references(() => vets.userId),
    version: integer('version').notNull().default(1), // new version for post-approval critical changes
    reference: text('reference').notNull().unique(), // e.g. VL-2026-0412
    status: text('status', { enum: APPLICATION_STATUSES }).notNull().default('draft'),
    createdVia: text('created_via', { enum: APPLICATION_CREATED_VIA }).notNull().default('self'),
    createdBy: uuid('created_by').references(() => users.id), // the admin, if assisted
    currentStep: integer('current_step').notNull().default(1), // resume point for the wizard
    data: jsonb('data').notNull().default(emptyJson), // draft answers per step
    submittedAt: timestamptz('submitted_at'),
    claimedBy: uuid('claimed_by').references(() => users.id),
    claimedAt: timestamptz('claimed_at'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamptz('decided_at'),
    decisionReasons: text('decision_reasons').array(), // template keys, localized on display
    decisionNote: text('decision_note'), // shown to the vet
    internalNote: text('internal_note'), // admin-only
    flaggedFields: jsonb('flagged_fields'), // what the vet must fix on changes_requested
    checklist: jsonb('checklist'), // reviewer's verification checklist results
  },
  (t) => [
    check('vet_applications_status_check', oneOf(t.status, APPLICATION_STATUSES)),
    check('vet_applications_created_via_check', oneOf(t.createdVia, APPLICATION_CREATED_VIA)),
    unique('vet_applications_vet_user_id_version_key').on(t.vetUserId, t.version),
  ],
);

/** Highly sensitive (§17): visible only to verifiers and super admins via signed URLs. */
export const vetDocuments = pgTable(
  'vet_documents',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .notNull()
      .references(() => vetApplications.id),
    vetUserId: uuid('vet_user_id')
      .notNull()
      .references(() => vets.userId),
    kind: text('kind', { enum: VET_DOCUMENT_KINDS }).notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: VET_DOCUMENT_STATUSES }).notNull().default('uploaded'),
    flagReason: text('flag_reason'),
    expiresAt: date('expires_at'), // e.g. licence expiry
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamptz('reviewed_at'),
  },
  (t) => [
    check('vet_documents_kind_check', oneOf(t.kind, VET_DOCUMENT_KINDS)),
    check('vet_documents_status_check', oneOf(t.status, VET_DOCUMENT_STATUSES)),
    index('vet_documents_application_id_idx').on(t.applicationId),
  ],
);
