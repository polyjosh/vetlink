import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  BOOKING_STATUSES,
  CHANNELS,
  MEDIA_KINDS,
  OFFER_CHANNELS,
  OFFER_RESPONSES,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  REMINDER_TYPES,
} from '@vetlink/shared';
import { createdAt, oneOf, timestamptz } from './helpers.js';
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
    species: text('species').notNull(),
    nameOrTag: text('name_or_tag'),
    breed: text('breed'),
    dob: date('dob'),
    sex: text('sex'),
  },
  (t) => [index('animals_farmer_id_idx').on(t.farmerId)],
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
    species: text('species').notNull(),
    problemType: text('problem_type').notNull(),
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
    idempotencyKey: text('idempotency_key').unique(), // from client, prevents double booking
    createdAt: createdAt(),
    acceptedAt: timestamptz('accepted_at'),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    check('bookings_source_channel_check', oneOf(t.sourceChannel, CHANNELS)),
    check('bookings_status_check', oneOf(t.status, BOOKING_STATUSES)),
    check('bookings_fee_quoted_check', sql`${t.feeQuoted} >= 0`),
    index('bookings_status_created_at_idx').on(t.status, t.createdAt),
    index('bookings_farmer_id_idx').on(t.farmerId),
    index('bookings_vet_id_idx').on(t.vetId),
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
    wave: integer('wave').notNull(),
    channel: text('channel', { enum: OFFER_CHANNELS }).notNull(),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
    respondedAt: timestamptz('responded_at'),
    response: text('response', { enum: OFFER_RESPONSES }),
  },
  (t) => [
    check('booking_offers_channel_check', oneOf(t.channel, OFFER_CHANNELS)),
    check('booking_offers_response_check', oneOf(t.response, OFFER_RESPONSES)),
    // One offer per vet per booking; also serves lookups by booking_id.
    uniqueIndex('booking_offers_booking_id_vet_id_key').on(t.bookingId, t.vetId),
    index('booking_offers_vet_id_idx').on(t.vetId),
  ],
);

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
    mpesaReceipt: text('mpesa_receipt').unique(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    check('payments_type_check', oneOf(t.type, PAYMENT_TYPES)),
    check('payments_status_check', oneOf(t.status, PAYMENT_STATUSES)),
    // Direction comes from `type` (refund), so every amount is positive.
    check('payments_amount_check', sql`${t.amount} > 0`),
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
    createdAt: createdAt(),
  },
  (t) => [check('media_kind_check', oneOf(t.kind, MEDIA_KINDS))],
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
    createdAt: createdAt(),
  },
  (t) => [check('ratings_stars_check', sql`${t.stars} between 1 and 5`)],
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
