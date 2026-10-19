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

export const MEDIA_KINDS = [
  'animal_photo',
  'booking_photo',
  'treatment_photo',
  'avatar',
  'booking_voice',
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Review state of a media row. Only vet avatars are reviewed (§24.1); everything else is `none`. */
export const MEDIA_REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type MediaReviewStatus = (typeof MEDIA_REVIEW_STATUSES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

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
  // §24.6: the farmer chose a vet; waiting for them, or for the farmer to choose again or pay.
  'requested',
  'vet_unavailable',
  'awaiting_deposit',
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
  // §24.20: the chosen-vet flow.
  'vet_declined_request',
  'request_timed_out',
  'farmer_rechose',
  'farmer_switched_to_auto',
  'deposit_timed_out',
  'request_abandoned',
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
  // §24.25: no refunds; the booking fee went to the farmer's VetLink wallet.
  'credited',
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

export const REMINDER_TYPES = ['vaccine', 'deworm', 'calving', 'follow_up'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Rating tags (§24.7): tap-to-pick chips, app and web only. */
export const POSITIVE_RATING_TAGS = [
  'on_time',
  'explained_well',
  'fair_price',
  'gentle_with_animal',
  'animal_recovered',
  'would_book_again',
] as const;
export const NEGATIVE_RATING_TAGS = ['late', 'unclear_price', 'rude'] as const;
export const RATING_TAGS = [...POSITIVE_RATING_TAGS, ...NEGATIVE_RATING_TAGS] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

/** Server-computed vet badges (§24.8); never self-claimed. */
export const VET_BADGES = [
  'verified',
  'top_rated',
  'fast_responder',
  'jobs_50',
  'jobs_100',
  'jobs_500',
  'vaccinations_100',
] as const;
export type VetBadge = (typeof VET_BADGES)[number];

/** Why a vet was flagged for admin review (§24.7). */
export const REVIEW_FLAG_REASONS = ['rude_rating', 'repeated_low_ratings'] as const;
export type ReviewFlagReason = (typeof REVIEW_FLAG_REASONS)[number];

/** Which chips to offer for a star rating: praise for 4-5, problems for 1-2, both for 3. */
export function ratingTagsFor(stars: number): readonly RatingTag[] {
  if (stars >= 4) return POSITIVE_RATING_TAGS;
  if (stars <= 2) return NEGATIVE_RATING_TAGS;
  return RATING_TAGS;
}

/** How a booking finds its vet (§24.5): waves (pay first), or the farmer's own choice. */
export const DISPATCH_MODES = ['auto', 'chosen'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

/** A wave offer (§8.5) or a direct request to the vet the farmer chose (§24.6). */
export const OFFER_KINDS = ['wave', 'direct'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** How a booking fee was paid (§24.25): by M-Pesa, entirely from the wallet, or partly. */
export const PAYMENT_METHODS = ['mpesa', 'wallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Wallet ledger entries (§24.25). Credits are positive, debits negative. */
export const WALLET_ENTRY_KINDS = [
  'credit_no_vet',
  'credit_cancelled',
  'credit_late_payment',
  'debit_booking_fee',
  'adjustment',
  'expired',
] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];

/** Wallet credit expires after this many days without wallet activity (§24.25). */
export const WALLET_EXPIRY_DAYS = 365;
