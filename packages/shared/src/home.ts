import { TERMINAL_BOOKING_STATUSES } from './bookings.js';
import type { BookingStatus, ProblemType, Species } from './domain.js';
import { eatDateOf } from './schedule.js';

/** Farmer home views shared by web and mobile (presentation only; the server decides status). */

interface BookingLike {
  id: number;
  status: BookingStatus;
  species: Species;
  problemType: ProblemType;
  scheduledFor: string | null;
  vet: { name: string | null } | null;
  requestedVet: { name: string | null } | null;
  treatment: { followUpDate: string | null; followUpBookingId: number | null } | null;
}

export interface ComingUpItem {
  key: string;
  kind: 'visit' | 'follow_up';
  /** ISO timestamp (visit) or YYYY-MM-DD (follow-up). */
  at: string;
  bookingId: number;
  species: Species;
  problemType: ProblemType;
  vetName: string | null;
}

/**
 * What is coming up: scheduled visits still open, and follow-up dates the vet set that have not
 * been booked yet, soonest first.
 */
export function comingUp(bookings: readonly BookingLike[], now: Date = new Date()): ComingUpItem[] {
  const today = eatDateOf(now);
  const out: ComingUpItem[] = [];
  for (const b of bookings) {
    const vetName = b.vet?.name ?? b.requestedVet?.name ?? null;
    if (
      b.scheduledFor &&
      !TERMINAL_BOOKING_STATUSES.includes(b.status) &&
      b.scheduledFor >= now.toISOString()
    )
      out.push({
        key: `v${b.id}`,
        kind: 'visit',
        at: b.scheduledFor,
        bookingId: b.id,
        species: b.species,
        problemType: b.problemType,
        vetName,
      });
    const f = b.treatment?.followUpDate;
    if (f && !b.treatment?.followUpBookingId && f >= today)
      out.push({
        key: `f${b.id}`,
        kind: 'follow_up',
        at: f,
        bookingId: b.id,
        species: b.species,
        problemType: b.problemType,
        vetName,
      });
  }
  return out.sort((a, b) => dateOf(a.at).localeCompare(dateOf(b.at)));
}

/** Animal counts per species, largest first. */
export function speciesCounts(
  animals: readonly { species: Species }[],
): { species: Species; count: number }[] {
  const counts = new Map<Species, number>();
  for (const a of animals) counts.set(a.species, (counts.get(a.species) ?? 0) + 1);
  return [...counts]
    .map(([species, count]) => ({ species, count }))
    .sort((a, b) => b.count - a.count);
}

/** "NOV" and "03" for a date box: a YYYY-MM-DD date, or an instant on its Nairobi date. */
export function dayBox(at: string, locale: string): { month: string; day: string } {
  const date = at.length === 10 ? at : eatDateOf(new Date(at));
  const d = new Date(`${date}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString(locale, { timeZone: 'UTC', ...o });
  return {
    month: part({ month: 'short' }).replace('.', '').toUpperCase(),
    day: part({ day: '2-digit' }),
  };
}

function dateOf(at: string): string {
  return at.length === 10 ? at : eatDateOf(new Date(at));
}

/** The tracking timeline's steps, in order; `null` is the request being made. */
export const TRACKING_STEPS = [null, 'matched', 'en_route', 'in_service', 'done'] as const;
export type TrackingStep = (typeof TRACKING_STEPS)[number];

const REACHED: Partial<Record<BookingStatus, number>> = {
  matched: 1,
  en_route: 2,
  in_service: 3,
  done: 4,
};

/**
 * Each step with its state and when it was reached. The booking's current step is `current`,
 * except a finished visit (all done) and an ended request (cancelled or expired: no current step).
 */
export function trackingSteps(b: {
  status: BookingStatus;
  createdAt: string;
  timeline: readonly { status: BookingStatus; at: string }[];
}): { step: TrackingStep; state: 'done' | 'current' | 'upcoming'; at: string | null }[] {
  const reached = REACHED[b.status] ?? 0;
  const ended = b.status === 'cancelled' || b.status === 'expired';
  return TRACKING_STEPS.map((step, i) => ({
    step,
    state:
      i < reached || b.status === 'done'
        ? 'done'
        : i === reached && !ended
          ? 'current'
          : 'upcoming',
    at: step === null ? b.createdAt : (b.timeline.find((e) => e.status === step)?.at ?? null),
  }));
}
