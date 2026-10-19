import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  BOOKING_ACTOR_KINDS,
  BOOKING_EVENTS,
  BOOKING_STATUSES,
  CHANNELS,
  DISPATCH_MODES,
  OFFER_KINDS,
  PAYMENT_METHODS,
  WALLET_ENTRY_KINDS,
  MEDIA_KINDS,
  MEDIA_REVIEW_STATUSES,
  PHOTO_REJECT_REASONS,
  OFFER_CHANNELS,
  OFFER_RESPONSES,
  PAYMENT_STATUSES,
  ANIMAL_SEXES,
  PAYMENT_TYPES,
  PROBLEM_TYPES,
  REMINDER_TYPES,
  RATING_TAGS,
  SPECIES,
  VET_SERVICES,
  type PriceBreakdown,
  type PriceRange,
} from '@vetlink/shared';
import { createdAt, emptyTextArray, oneOf, subsetOf, timestamptz } from './helpers.js';
import { users } from './identity.js';
import { farmers, vets } from './profiles.js';
import { locations } from './reference.js';

export const animals = pgTable(
  'animals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    farmerId: uuid('farmer_id')
      .notNull()
      .references(() => farmers.userId),
    species: text('species', { enum: SPECIES }).notNull(),
    nameOrTag: text('name_or_tag'),
    breed: text('breed'),
    dob: date('dob'),
    sex: text('sex', { enum: ANIMAL_SEXES }),
    photoMediaId: uuid('photo_media_id').references((): AnyPgColumn => media.id), // §24.2
  },
  (t) => [
    check('animals_species_check', oneOf(t.species, SPECIES)),
    check('animals_sex_check', oneOf(t.sex, ANIMAL_SEXES)),
    index('animals_farmer_id_idx').on(t.farmerId),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(), // short numeric ID suits SMS replies
    farmerId: uuid('farmer_id')
      .notNull()
      .references(() => farmers.userId),
    vetId: uuid('vet_id').references(() => vets.userId),
    animalId: uuid('animal_id').references(() => animals.id),
    species: text('species', { enum: SPECIES }).notNull(),
    problemType: text('problem_type', { enum: PROBLEM_TYPES }).notNull(),
    note: text('note'),
    isEmergency: boolean('is_emergency').notNull().default(false),
    sourceChannel: text('source_channel', { enum: CHANNELS }).notNull(),
    wardId: integer('ward_id')
      .notNull()
      .references(() => locations.id),
    lat: doublePrecision('lat'), // present when app/web pinned
    lng: doublePrecision('lng'),
    // Changes only through bookings/transitions.ts (invariant 3).
    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('pending_payment'),
    feeQuoted: integer('fee_quoted').notNull(), // KES, set by the server, never the client
    // §24.3 and §24.24: added services, VetLink's booking fee (as charged for this booking), the
    // range shown before a vet accepted, and the accepting vet's price fixed at acceptance.
    services: text('services', { enum: VET_SERVICES }).array().notNull().default(emptyTextArray),
    bookingFeeKes: integer('booking_fee_kes').notNull().default(200),
    priceRange: jsonb('price_range').$type<PriceRange>(),
    vetPrice: jsonb('vet_price').$type<PriceBreakdown>(),
    // §24.5, §24.6: how the vet is found; the vet the farmer chose; when the system moves the
    // booking on if nobody acts (vet answer, booking fee, or choosing again).
    dispatchMode: text('dispatch_mode', { enum: DISPATCH_MODES }).notNull().default('auto'),
    requestedVetId: uuid('requested_vet_id').references(() => vets.userId),
    statusDeadlineAt: timestamptz('status_deadline_at'),
    idempotencyKey: text('idempotency_key').unique(), // from client, prevents double booking
    createdAt: createdAt(),
    acceptedAt: timestamptz('accepted_at'),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    check('bookings_source_channel_check', oneOf(t.sourceChannel, CHANNELS)),
    check('bookings_status_check', oneOf(t.status, BOOKING_STATUSES)),
    check('bookings_species_check', oneOf(t.species, SPECIES)),
    check('bookings_problem_type_check', oneOf(t.problemType, PROBLEM_TYPES)),
    check('bookings_fee_quoted_check', sql`${t.feeQuoted} >= 0`),
    check('bookings_services_check', subsetOf(t.services, VET_SERVICES)),
    check('bookings_booking_fee_check', sql`${t.bookingFeeKes} > 0`),
    check('bookings_dispatch_mode_check', oneOf(t.dispatchMode, DISPATCH_MODES)),
    index('bookings_status_deadline_idx')
      .on(t.statusDeadlineAt)
      .where(sql`${t.statusDeadlineAt} is not null`),
    index('bookings_status_created_at_idx').on(t.status, t.createdAt),
    index('bookings_farmer_id_idx').on(t.farmerId),
    index('bookings_vet_id_idx').on(t.vetId),
  ],
);

/**
 * Every booking status change, written by `bookings/transitions.ts` in the same transaction as
 * the change. Drives the tracking timeline and the audit trail; append-only.
 */
export const bookingEvents = pgTable(
  'booking_events',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .notNull()
      .references(() => bookings.id),
    event: text('event', { enum: BOOKING_EVENTS }).notNull(),
    fromStatus: text('from_status', { enum: BOOKING_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: BOOKING_STATUSES }).notNull(),
    actorKind: text('actor_kind', { enum: BOOKING_ACTOR_KINDS }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    channel: text('channel', { enum: CHANNELS }),
    reason: text('reason'), // e.g. cancellation reason; never PII
    createdAt: createdAt(),
  },
  (t) => [
    check('booking_events_event_check', oneOf(t.event, BOOKING_EVENTS)),
    check('booking_events_from_status_check', oneOf(t.fromStatus, BOOKING_STATUSES)),
    check('booking_events_to_status_check', oneOf(t.toStatus, BOOKING_STATUSES)),
    check('booking_events_actor_kind_check', oneOf(t.actorKind, BOOKING_ACTOR_KINDS)),
    check('booking_events_channel_check', oneOf(t.channel, CHANNELS)),
    index('booking_events_booking_id_idx').on(t.bookingId),
  ],
);

export const bookingOffers = pgTable(
  'booking_offers',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .notNull()
      .references(() => bookings.id),
    vetId: uuid('vet_id')
      .notNull()
      .references(() => vets.userId),
    wave: integer('wave').notNull(), // 0 for a direct request (§24.6)
    kind: text('kind', { enum: OFFER_KINDS }).notNull().default('wave'),
    channel: text('channel', { enum: OFFER_CHANNELS }).notNull(),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
    respondedAt: timestamptz('responded_at'),
    response: text('response', { enum: OFFER_RESPONSES }),
  },
  (t) => [
    check('booking_offers_channel_check', oneOf(t.channel, OFFER_CHANNELS)),
    check('booking_offers_response_check', oneOf(t.response, OFFER_RESPONSES)),
    check('booking_offers_kind_check', oneOf(t.kind, OFFER_KINDS)),
    // One offer per vet per booking; also serves lookups by booking_id.
    uniqueIndex('booking_offers_booking_id_vet_id_key').on(t.bookingId, t.vetId),
    index('booking_offers_vet_id_idx').on(t.vetId),
  ],
);

/**
 * M-Pesa money movements (§8.6). Only the server changes `status`: from Daraja callbacks
 * (confirmed by an STK query), reconciliation, or a finance admin recording a refund.
 */
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .notNull()
      .references(() => bookings.id),
    type: text('type', { enum: PAYMENT_TYPES }).notNull(),
    amount: integer('amount').notNull(), // KES, integer
    checkoutRequestId: text('checkout_request_id').unique(),
    merchantRequestId: text('merchant_request_id'),
    mpesaReceipt: text('mpesa_receipt').unique(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    phone: text('phone'), // payer (deposit) or payee (refund), 2547XXXXXXXX
    resultCode: integer('result_code'), // Daraja ResultCode, when known
    resultDesc: text('result_desc'),
    // A refund points at the deposit it returns; one refund per deposit.
    refundOf: integer('refund_of')
      .unique()
      .references((): AnyPgColumn => payments.id),
    // §24.25: `amount` is the whole booking fee; `wallet_amount` of it comes from the wallet, the
    // rest by STK push. `wallet`: all of it from the wallet (no M-Pesa at all).
    method: text('method', { enum: PAYMENT_METHODS }).notNull().default('mpesa'),
    walletAmount: integer('wallet_amount').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('payments_type_check', oneOf(t.type, PAYMENT_TYPES)),
    check('payments_status_check', oneOf(t.status, PAYMENT_STATUSES)),
    // Direction comes from `type` (refund), so every amount is positive.
    check('payments_amount_check', sql`${t.amount} > 0`),
    check('payments_method_check', oneOf(t.method, PAYMENT_METHODS)),
    check(
      'payments_wallet_amount_check',
      sql`${t.walletAmount} >= 0 and ${t.walletAmount} <= ${t.amount}`,
    ),
    check('payments_refund_of_check', sql`(${t.type} = 'refund') = (${t.refundOf} is not null)`),
    // At most one STK push in flight per booking, and never two paid deposits.
    uniqueIndex('payments_one_pending_deposit_key')
      .on(t.bookingId)
      .where(sql`${t.type} = 'deposit' and ${t.status} = 'pending'`),
    uniqueIndex('payments_one_paid_deposit_key')
      .on(t.bookingId)
      .where(sql`${t.type} = 'deposit' and ${t.status} in ('success', 'refunded')`),
    index('payments_status_created_at_idx').on(t.status, t.createdAt),
  ],
);

/**
 * The farmer's VetLink wallet (§24.25): an append-only ledger. The balance is the sum. Credits
 * replace refunds; debits pay booking fees. One entry per booking and kind, so a retried
 * cancellation or payment never credits or debits twice.
 */
export const walletEntries = pgTable(
  'wallet_entries',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(), // KES: positive credit, negative debit
    kind: text('kind', { enum: WALLET_ENTRY_KINDS }).notNull(),
    bookingId: integer('booking_id').references(() => bookings.id),
    note: text('note'), // adjustments: the admin's reason
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('wallet_entries_kind_check', oneOf(t.kind, WALLET_ENTRY_KINDS)),
    check('wallet_entries_amount_check', sql`${t.amount} <> 0`),
    uniqueIndex('wallet_entries_booking_kind_key')
      .on(t.bookingId, t.kind)
      .where(sql`${t.bookingId} is not null`),
    index('wallet_entries_user_idx').on(t.userId, t.createdAt),
  ],
);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull(),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    animalId: uuid('animal_id').references(() => animals.id),
    bookingId: integer('booking_id').references(() => bookings.id),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    // Only vet avatars are reviewed (§24.1); everything else stays `none`.
    reviewStatus: text('review_status', { enum: MEDIA_REVIEW_STATUSES }).notNull().default('none'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamptz('reviewed_at'),
    reviewReason: text('review_reason', { enum: PHOTO_REJECT_REASONS }),
    createdAt: createdAt(),
  },
  (t) => [
    check('media_kind_check', oneOf(t.kind, MEDIA_KINDS)),
    check('media_review_status_check', oneOf(t.reviewStatus, MEDIA_REVIEW_STATUSES)),
    check('media_review_reason_check', oneOf(t.reviewReason, PHOTO_REJECT_REASONS)),
    uniqueIndex('media_storage_key_key').on(t.storageKey),
    index('media_owner_kind_idx').on(t.ownerUserId, t.kind),
    index('media_pending_review_idx')
      .on(t.createdAt)
      .where(sql`${t.reviewStatus} = 'pending'`),
  ],
);

export const treatments = pgTable(
  'treatments',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .notNull()
      .references(() => bookings.id),
    animalId: uuid('animal_id').references(() => animals.id),
    diagnosis: text('diagnosis'),
    diagnosisCode: text('diagnosis_code'), // normalized for outbreak queries
    drugsUsed: text('drugs_used'),
    rawNotes: text('raw_notes').notNull(), // original SMS or form text
    followUpDate: date('follow_up_date'),
    // §24.4: the booking that rebooked this follow-up (alerts stop), and the vet's alerts sent.
    followUpBookingId: integer('follow_up_booking_id').references((): AnyPgColumn => bookings.id),
    vetAlertEveningSentAt: timestamptz('vet_alert_evening_sent_at'),
    vetAlertDaySentAt: timestamptz('vet_alert_day_sent_at'),
    clientCreatedAt: timestamptz('client_created_at'), // when logged offline on device
    createdAt: createdAt(),
  },
  (t) => [index('treatments_diagnosis_code_created_at_idx').on(t.diagnosisCode, t.createdAt)],
);

export const ratings = pgTable(
  'ratings',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    tags: text('tags', { enum: RATING_TAGS }).array().notNull().default(emptyTextArray), // §24.7
    createdAt: createdAt(),
  },
  (t) => [
    check('ratings_stars_check', sql`${t.stars} between 1 and 5`),
    check('ratings_tags_check', subsetOf(t.tags, RATING_TAGS)),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: serial('id').primaryKey(),
    animalId: uuid('animal_id')
      .notNull()
      .references(() => animals.id),
    type: text('type', { enum: REMINDER_TYPES }).notNull(),
    dueDate: date('due_date').notNull(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    check('reminders_type_check', oneOf(t.type, REMINDER_TYPES)),
    index('reminders_due_date_unsent_idx')
      .on(t.dueDate)
      .where(sql`${t.sentAt} is null`),
  ],
);
