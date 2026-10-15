import type {
  BookingActorKind,
  BookingEvent,
  BookingStatus,
  Channel,
  ProblemType,
  Species,
  VetType,
} from './domain.js';

/**
 * The booking state machine (§9). The API applies it in one place (`bookings/transitions.ts`);
 * clients use it only to decide which buttons to show. The server always re-checks.
 *
 * pending_payment ─deposit_confirmed→ pending ─vet_accepted→ matched ─vet_en_route→ en_route
 *   ─vet_arrived→ in_service ─vet_completed→ done
 */
export interface TransitionRule {
  from: readonly BookingStatus[];
  to: BookingStatus;
  /** Who may trigger it. Farmer and vet events also require owning / being assigned the booking. */
  actors: readonly BookingActorKind[];
}

export const BOOKING_TRANSITIONS: Record<BookingEvent, TransitionRule> = {
  deposit_confirmed: { from: ['pending_payment'], to: 'pending', actors: ['system'] },
  payment_failed: { from: ['pending_payment'], to: 'expired', actors: ['system'] },
  vet_accepted: { from: ['pending'], to: 'matched', actors: ['vet'] },
  // The assigned vet hands the job back before setting off; the booking is dispatched again.
  vet_released: { from: ['matched'], to: 'pending', actors: ['vet'] },
  vet_en_route: { from: ['matched'], to: 'en_route', actors: ['vet'] },
  vet_arrived: { from: ['en_route'], to: 'in_service', actors: ['vet'] },
  // From en_route/matched too: SMS vets often skip ARR, and offline outboxes may batch steps.
  vet_completed: { from: ['matched', 'en_route', 'in_service'], to: 'done', actors: ['vet'] },
  // Not once the vet is with the animal. After en_route the deposit is forfeited (§8.6).
  farmer_cancelled: {
    from: ['pending_payment', 'pending', 'matched', 'en_route'],
    to: 'cancelled',
    actors: ['farmer'],
  },
  no_vet_found: { from: ['pending'], to: 'cancelled', actors: ['system'] },
  admin_cancelled: {
    from: ['pending_payment', 'pending', 'matched', 'en_route', 'in_service'],
    to: 'cancelled',
    actors: ['admin'],
  },
};

export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = ['done', 'cancelled', 'expired'];

/** Statuses in which an assigned vet is on the job (counts against the vet's concurrency). */
export const ACTIVE_JOB_STATUSES: readonly BookingStatus[] = ['matched', 'en_route', 'in_service'];

export function canTransition(
  status: BookingStatus,
  event: BookingEvent,
  actor: BookingActorKind,
): boolean {
  const rule = BOOKING_TRANSITIONS[event];
  return rule.from.includes(status) && rule.actors.includes(actor);
}

/** Events an actor could trigger from a status (for showing buttons). */
export function availableEvents(status: BookingStatus, actor: BookingActorKind): BookingEvent[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingEvent[]).filter((e) =>
    canTransition(status, e, actor),
  );
}

/** Deposit taken by STK push at confirmation (§8.6). Balance is paid to the vet directly. */
export const DEPOSIT_KES = 200;

/** Offer response window (§8.5). */
export const OFFER_TIMEOUT_S = { normal: 90, emergency: 45 } as const;

/** Statuses in which each side may see the other's phone number (§17: only after a match). */
export const CONTACT_VISIBLE_STATUSES: readonly BookingStatus[] = ACTIVE_JOB_STATUSES;

export interface WardView {
  id: number;
  ward: string;
  subCounty: string;
  county: string;
}

export interface TimelineEntry {
  event: BookingEvent;
  status: BookingStatus;
  at: string;
}

/** What the farmer who owns the booking sees. */
export interface FarmerBookingView {
  id: number;
  status: BookingStatus;
  species: Species;
  problemType: ProblemType;
  note: string | null;
  isEmergency: boolean;
  sourceChannel: Channel;
  ward: WardView;
  feeQuoted: number;
  depositKes: number;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  timeline: TimelineEntry[];
  /** Name, type and rating once matched; phone only while the job is active. */
  vet: { name: string | null; type: VetType; rating: number | null; phone: string | null } | null;
  treatment: {
    diagnosis: string | null;
    drugsUsed: string | null;
    followUpDate: string | null;
  } | null;
  rating: { stars: number; comment: string | null } | null;
  /** Events the farmer can trigger now (e.g. `farmer_cancelled`). */
  actions: BookingEvent[];
}

/** What the assigned vet sees. */
export interface VetJobView {
  id: number;
  status: BookingStatus;
  species: Species;
  problemType: ProblemType;
  note: string | null;
  isEmergency: boolean;
  ward: WardView;
  /** Pinned farm location, else the ward centroid. */
  location: { lat: number; lng: number; precise: boolean } | null;
  feeQuoted: number;
  acceptedAt: string | null;
  completedAt: string | null;
  timeline: TimelineEntry[];
  /** Phone only while the job is active. */
  farmer: { name: string | null; phone: string | null; farmNotes: string | null };
  actions: BookingEvent[];
}

/** An open job offer: no farmer identity until the vet accepts (§17). */
export interface OfferView {
  offerId: number;
  bookingId: number;
  species: Species;
  problemType: ProblemType;
  isEmergency: boolean;
  ward: WardView;
  feeQuoted: number;
  wave: number;
  sentAt: string;
  expiresAt: string;
}
