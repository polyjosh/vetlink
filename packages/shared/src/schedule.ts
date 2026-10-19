import type { Weekday, WorkingHours } from './pricing.js';

/**
 * Scheduled appointments (§24.10): a day in the next 14 days and a part of it, Nairobi time
 * (EAT, UTC+3, no daylight saving). Parts of day are easier than exact times.
 */
export const SCHEDULE_PARTS = ['morning', 'afternoon', 'evening'] as const;
export type SchedulePart = (typeof SCHEDULE_PARTS)[number];

/** Each part as [from, to) in "HH:MM", Nairobi time. */
export const SCHEDULE_PART_HOURS: Record<SchedulePart, { from: string; to: string }> = {
  morning: { from: '08:00', to: '12:00' },
  afternoon: { from: '12:00', to: '16:00' },
  evening: { from: '16:00', to: '19:00' },
};

export const SCHEDULE_DAYS_AHEAD = 14;
/** A slot must start at least this far ahead when it is booked. */
export const SCHEDULE_MIN_LEAD_MS = 2 * 3600 * 1000;
/** The vet answers a scheduled request within this, but never later than 1 h before the slot. */
export const SCHEDULE_ANSWER_MS = 2 * 3600 * 1000;
export const SCHEDULE_ANSWER_BEFORE_SLOT_MS = 3600 * 1000;

const EAT_MS = 3 * 3600 * 1000;
const WEEKDAY_OF_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** When a slot starts and ends (UTC instants) for a YYYY-MM-DD date in Nairobi. */
export function slotWindow(date: string, part: SchedulePart): { start: Date; end: Date } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = (hhmm: string) => {
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1, d, hh, mm) - EAT_MS);
  };
  const h = SCHEDULE_PART_HOURS[part];
  return { start: at(h.from), end: at(h.to) };
}

/** The Nairobi calendar date (YYYY-MM-DD) of an instant. */
export function eatDateOf(at: Date): string {
  return new Date(at.getTime() + EAT_MS).toISOString().slice(0, 10);
}

/** Why a slot cannot be booked now, or null if it can. */
export function slotProblem(
  date: string,
  part: SchedulePart,
  now: Date,
): 'invalid' | 'too_soon' | 'too_far' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'invalid';
  const { start } = slotWindow(date, part);
  if (start.getTime() - now.getTime() < SCHEDULE_MIN_LEAD_MS) return 'too_soon';
  const last = Date.parse(eatDateOf(now)) + SCHEDULE_DAYS_AHEAD * 24 * 3600 * 1000;
  if (Date.parse(date) > last) return 'too_far';
  return null;
}

/** Does a vet's week cover any of this slot? (Working hours are Nairobi "HH:MM".) */
export function hoursCoverSlot(
  hours: WorkingHours | null | undefined,
  date: string,
  part: SchedulePart,
): boolean {
  if (!hours) return false;
  const weekday = WEEKDAY_OF_INDEX[new Date(`${date}T12:00:00Z`).getUTCDay()] as Weekday;
  const slot = SCHEDULE_PART_HOURS[part];
  return (hours[weekday] ?? []).some((r) => r.from < slot.to && slot.from < r.to);
}

/** When the vet must have answered a scheduled request made at `now`. */
export function scheduledAnswerDeadline(now: Date, slotStart: Date): Date {
  return new Date(
    Math.min(
      now.getTime() + SCHEDULE_ANSWER_MS,
      slotStart.getTime() - SCHEDULE_ANSWER_BEFORE_SLOT_MS,
    ),
  );
}
