import {
  BOOKING_EVENTS,
  BOOKING_STATUSES,
  CANCEL_REASONS,
  CHANNELS,
  DEPOSIT_STATES,
  OFFER_CHANNELS,
  OFFER_RESPONSES,
  PROBLEM_TYPES,
  SPECIES,
  VET_SERVICES,
  VET_TYPES,
  type FarmerBookingView,
  type OfferView,
  type VetJobView,
} from '@vetlink/shared';
import { z } from 'zod';
import { assertSameType, intId, named, type Equals } from '../../schemas/common.js';
import { wardView } from '../users/schemas.js';

/** One vet's price for one request (§24.3): all KES, computed by the server. */
export const priceBreakdown = named(
  z.object({
    consultation: z.number().int(),
    services: z.array(z.object({ service: z.enum(VET_SERVICES), fee: z.number().int() })),
    callOut: z.number().int(),
    total: z.number().int().describe('A starting price: medicine and extra work can cost more'),
    bookingFee: z.number().int().describe('Paid to VetLink when booking; part of the total'),
    payVet: z.number().int().describe('Paid to the vet on the farm: total minus booking fee'),
  }),
  'PriceBreakdown',
);

export const priceRange = named(
  z.object({
    min: z.number().int(),
    max: z.number().int(),
    bookingFee: z.number().int(),
    vets: z.number().int().describe('How many nearby vets the range is built from'),
  }),
  'PriceRange',
);

const timelineEntry = z.object({
  event: z.enum(BOOKING_EVENTS),
  status: z.enum(BOOKING_STATUSES),
  at: z.string(),
});

export const farmerBooking = named(
  z.object({
    id: z.number().int(),
    status: z.enum(BOOKING_STATUSES),
    species: z.enum(SPECIES),
    problemType: z.enum(PROBLEM_TYPES),
    note: z.string().nullable(),
    isEmergency: z.boolean(),
    sourceChannel: z.enum(CHANNELS),
    ward: wardView,
    feeQuoted: z.number().int().describe('KES, quoted by the server'),
    depositKes: z.number().int().describe("VetLink's booking fee for this booking (§24.24)"),
    services: z.array(z.enum(VET_SERVICES)).describe('Added to the consultation'),
    priceRange: priceRange.nullable().describe('Before a vet accepts'),
    price: priceBreakdown.nullable().describe("The accepting vet's price, fixed at acceptance"),
    deposit: z.object({
      status: z.enum(DEPOSIT_STATES),
      receipt: z.string().nullable(),
      paymentId: z.number().int().nullable(),
    }),
    createdAt: z.string(),
    acceptedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    timeline: z.array(timelineEntry),
    vet: z
      .object({
        name: z.string().nullable().describe('Verified legal name'),
        displayName: z.string().nullable(),
        photoUrl: z.string().nullable(),
        type: z.enum(VET_TYPES),
        rating: z.number().nullable(),
        phone: z.string().nullable().describe('Only while the job is active'),
      })
      .nullable(),
    treatment: z
      .object({
        diagnosis: z.string().nullable(),
        drugsUsed: z.string().nullable(),
        followUpDate: z.string().nullable(),
      })
      .nullable(),
    rating: z.object({ stars: z.number().int(), comment: z.string().nullable() }).nullable(),
    actions: z.array(z.enum(BOOKING_EVENTS)).describe('Events the farmer can trigger now'),
  }),
  'FarmerBooking',
);
assertSameType<Equals<z.infer<typeof farmerBooking>, FarmerBookingView>>();

export const vetJob = named(
  z.object({
    id: z.number().int(),
    status: z.enum(BOOKING_STATUSES),
    species: z.enum(SPECIES),
    problemType: z.enum(PROBLEM_TYPES),
    note: z.string().nullable(),
    isEmergency: z.boolean(),
    ward: wardView,
    location: z.object({ lat: z.number(), lng: z.number(), precise: z.boolean() }).nullable(),
    feeQuoted: z.number().int(),
    services: z.array(z.enum(VET_SERVICES)),
    price: priceBreakdown.nullable().describe('My price for this job; payVet is what I collect'),
    acceptedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    timeline: z.array(timelineEntry),
    farmer: z.object({
      name: z.string().nullable(),
      displayName: z.string().nullable().describe('Show this when set, else name'),
      photoUrl: z.string().nullable(),
      phone: z.string().nullable().describe('Only while the job is active'),
      farmNotes: z.string().nullable(),
    }),
    actions: z.array(z.enum(BOOKING_EVENTS)).describe('Events the vet can trigger now'),
  }),
  'VetJob',
);
assertSameType<Equals<z.infer<typeof vetJob>, VetJobView>>();

export const offer = named(
  z.object({
    offerId: z.number().int(),
    bookingId: z.number().int(),
    species: z.enum(SPECIES),
    problemType: z.enum(PROBLEM_TYPES),
    isEmergency: z.boolean(),
    ward: wardView,
    feeQuoted: z.number().int(),
    services: z.array(z.enum(VET_SERVICES)),
    price: priceBreakdown.nullable().describe('What this job pays at my current prices'),
    wave: z.number().int(),
    sentAt: z.string(),
    expiresAt: z.string(),
  }),
  'Offer',
);
assertSameType<Equals<z.infer<typeof offer>, OfferView>>();

export const adminBooking = named(
  farmerBooking.extend({
    farmer: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
    offers: z.array(
      z.object({
        id: z.number().int(),
        vetId: z.string(),
        wave: z.number().int(),
        channel: z.enum(OFFER_CHANNELS),
        sentAt: z.string(),
        respondedAt: z.string().nullable(),
        response: z.enum(OFFER_RESPONSES).nullable(),
      }),
    ),
  }),
  'AdminBooking',
);

export const bookingParams = z.object({ id: intId });
export const offerParams = z.object({ id: intId, offerId: intId });

export const createBookingBody = z.object({
  species: z.enum(SPECIES),
  problemType: z.enum(PROBLEM_TYPES),
  isEmergency: z.boolean().default(false),
  animalId: z.uuid().optional(),
  note: z.string().trim().max(500).optional(),
  wardId: intId.optional().describe("Defaults to the farmer's saved ward"),
  lat: z.number().min(-5).max(6).optional(), // Kenya's latitude range, with margin
  lng: z.number().min(33).max(42.5).optional(),
  services: z
    .array(z.enum(VET_SERVICES))
    .max(VET_SERVICES.length)
    .optional()
    .describe('Services added to the consultation (§24.3); none means consultation only'),
});
export const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .optional()
    .describe('Required. 8 to 128 chars [A-Za-z0-9_:-]; generate on tap, reuse on retry'),
  'x-vetlink-channel': z.enum(['app', 'web']).optional(),
});
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/);
export const listQuery = z.object({
  as: z.enum(['farmer', 'vet']).optional().describe('Required only for users with both roles'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: intId.optional(),
});
export const cancelBody = z.object({ reason: z.enum(CANCEL_REASONS) });
export const ratingBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
export const stepBody = z.object({ status: z.enum(['en_route', 'in_service']) });
export const completeBody = z.object({
  diagnosis: z.string().max(200).optional(),
  diagnosisCode: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
  drugsUsed: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  followUpDate: z.iso.date().optional(),
  clientCreatedAt: z.iso.datetime().optional().describe('When completed on the device (offline)'),
});
