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

export const OFFER_CHANNELS = ['push', 'sms', 'both'] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const OFFER_RESPONSES = ['accepted', 'declined', 'timeout'] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];

export const PAYMENT_TYPES = ['deposit', 'balance', 'refund'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REMINDER_TYPES = ['vaccine', 'deworm', 'calving', 'follow_up'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];
