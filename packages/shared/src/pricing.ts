import type { ProblemType, VetService } from './domain.js';

/**
 * Prices (§24.3, §24.24). Every request includes a consultation; the farmer may add services,
 * each with the vet's "from" price; the call-out fee covers the trip. VetLink's booking fee
 * (paid by M-Pesa when booking) counts towards that total, so the farmer pays the vet the rest
 * on the farm. All amounts are whole KES, computed by the server; clients only display them.
 */

/** The admin-set bands cover the consultation and every service. */
export const PRICED_ITEMS = [
  'consultation',
  'treatment',
  'vaccination',
  'artificial_insemination',
  'deworming',
  'pregnancy_diagnosis',
  'minor_surgery',
] as const satisfies readonly ('consultation' | VetService)[];
export type PricedItem = (typeof PRICED_ITEMS)[number];

/** Services pre-ticked for a problem; the farmer can untick them (and USSD uses them as is). */
export function servicesForProblem(problem: ProblemType): VetService[] {
  if (problem === 'vaccination') return ['vaccination'];
  if (problem === 'breeding') return ['artificial_insemination'];
  return [];
}

/** One vet's price for one request. */
export interface PriceBreakdown {
  consultation: number;
  services: { service: VetService; fee: number }[];
  callOut: number;
  /** consultation + services + callOut: a starting price ("from"). */
  total: number;
  /** Paid to VetLink when booking; counts towards `total`. */
  bookingFee: number;
  /** What the farmer pays the vet on the farm: `total - bookingFee`, never below 0. */
  payVet: number;
}

/** Before a vet is chosen: the spread of nearby vets' totals, or null when nobody is near. */
export interface PriceRange {
  min: number;
  max: number;
  bookingFee: number;
  /** How many vets the range is built from. */
  vets: number;
}

export function priceBreakdown(input: {
  consultation: number;
  serviceFees: Partial<Record<VetService, number>>;
  services: readonly VetService[];
  callOut: number;
  bookingFee: number;
}): PriceBreakdown {
  const services = input.services.map((service) => ({
    service,
    fee: input.serviceFees[service] ?? 0,
  }));
  const total = input.consultation + services.reduce((a, s) => a + s.fee, 0) + input.callOut;
  return {
    consultation: input.consultation,
    services,
    callOut: input.callOut,
    total,
    bookingFee: input.bookingFee,
    payVet: Math.max(0, total - input.bookingFee),
  };
}

/** Working hours per weekday (§24.10), up to two ranges a day, "HH:MM" in Nairobi time. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WorkingHours = Partial<Record<Weekday, { from: string; to: string }[]>>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: [{ from: '08:00', to: '17:00' }],
  tue: [{ from: '08:00', to: '17:00' }],
  wed: [{ from: '08:00', to: '17:00' }],
  thu: [{ from: '08:00', to: '17:00' }],
  fri: [{ from: '08:00', to: '17:00' }],
  sat: [{ from: '08:00', to: '17:00' }],
};
