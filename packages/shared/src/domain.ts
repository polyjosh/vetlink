// Allowed values for every enumerated column (CLAUDE.md §9). The database CHECK constraints,
// zod schemas, and clients all derive from these arrays; never repeat the strings elsewhere.

/** Self-service roles stored on `users.roles`. Admin is never stored here. */
export const USER_ROLES = ['farmer', 'vet'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a session can act as. `admin` is derived only from an `admin_profiles` row with
 * `revoked_at IS NULL`, so revoking that row revokes admin access everywhere.
 */
export const SESSION_ROLES = [...USER_ROLES, 'admin'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export const ADMIN_ROLES = ['super_admin', 'verifier', 'support', 'finance', 'analyst'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Why an auth session (one login on one device) was ended. */
export const SESSION_REVOKED_REASONS = ['logout', 'refresh_token_reuse'] as const;
export type SessionRevokedReason = (typeof SESSION_REVOKED_REASONS)[number];

export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const VET_TYPES = ['vet', 'paravet'] as const;
export type VetType = (typeof VET_TYPES)[number];

export const PRACTICE_TYPES = ['independent', 'clinic', 'agrovet'] as const;
export type PracticeType = (typeof PRACTICE_TYPES)[number];

/** Only `approved` vets may receive offers (invariant 2). */
export const VERIFICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'suspended',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_CREATED_VIA = ['self', 'admin_assisted'] as const;
export type ApplicationCreatedVia = (typeof APPLICATION_CREATED_VIA)[number];

export const VET_DOCUMENT_KINDS = [
  'id_front',
  'id_back',
  'certificate',
  'licence',
  'profile_photo',
  'training_cert',
] as const;
export type VetDocumentKind = (typeof VET_DOCUMENT_KINDS)[number];

export const VET_DOCUMENT_STATUSES = ['uploaded', 'accepted', 'flagged'] as const;
export type VetDocumentStatus = (typeof VET_DOCUMENT_STATUSES)[number];

export const MEDIA_KINDS = ['animal_photo', 'booking_photo', 'treatment_photo'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const CHANNELS = ['ussd', 'sms', 'app', 'web', 'admin'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Change only through `bookings/transitions.ts` (invariant 3). */
/** Species a booking is for; also the vocabulary of `vets.specialties` (matching joins on it). */
export const SPECIES = ['cattle', 'goat', 'sheep', 'pig', 'poultry', 'dog', 'other'] as const;
export type Species = (typeof SPECIES)[number];

export const ANIMAL_SEXES = ['female', 'male'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** What the farmer reports. Emergency is a separate flag, not a problem type. */
export const PROBLEM_TYPES = ['sick', 'injury', 'breeding', 'vaccination', 'other'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

/** Services a vet offers (`vets.services`). */
export const VET_SERVICES = [
  'treatment',
  'vaccination',
  'artificial_insemination',
  'deworming',
  'pregnancy_diagnosis',
  'minor_surgery',
] as const;
export type VetService = (typeof VET_SERVICES)[number];

export const BOOKING_STATUSES = [
  'pending_payment',
  'pending',
  'matched',
  'en_route',
  'in_service',
  'done',
  'cancelled',
  'expired',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Every booking status change is one of these events (see `bookings.ts` for the rules). */
export const BOOKING_EVENTS = [
  'deposit_confirmed',
  'payment_failed',
  'vet_accepted',
  'vet_released',
  'vet_en_route',
  'vet_arrived',
  'vet_completed',
  'farmer_cancelled',
  'no_vet_found',
  'admin_cancelled',
] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];

/** Why a farmer cancelled (a fixed list: free text could carry personal data into logs). */
export const CANCEL_REASONS = [
  'changed_mind',
  'vet_too_far',
  'found_other_help',
  'animal_recovered',
  'other',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const BOOKING_ACTOR_KINDS = ['farmer', 'vet', 'admin', 'system'] as const;
export type BookingActorKind = (typeof BOOKING_ACTOR_KINDS)[number];

export const OFFER_CHANNELS = ['push', 'sms', 'both'] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const OFFER_RESPONSES = ['accepted', 'declined', 'timeout'] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];

export const PAYMENT_TYPES = ['deposit', 'balance', 'refund'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The deposit as the farmer sees it (derived from `payments`; clients never set it). */
export const DEPOSIT_STATES = [
  'none',
  'pending',
  'paid',
  'failed',
  'refund_pending',
  'refunded',
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

export const REMINDER_TYPES = ['vaccine', 'deworm', 'calving', 'follow_up'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];
