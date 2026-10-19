import type { BookingEvent, BookingStatus } from '@vetlink/shared';

/**
 * Money rules in one place (§8.6). Deposit-only model (Open Question 21.2): VetLink takes the
 * deposit by STK push; the farmer pays the balance to the vet directly.
 */

export type DepositOutcome = 'credit' | 'forfeit' | 'none';

/**
 * What happens to a paid booking fee (the deposit) when a booking is cancelled. Nothing is
 * ever refunded to M-Pesa (§24.25): it goes to the farmer's wallet if no vet accepted, the
 * farmer cancelled before the vet set off, or an admin cancelled; VetLink keeps it if the
 * farmer cancels once the vet is on the way (§24.24).
 */
export function depositOutcomeOnCancel(from: BookingStatus, event: BookingEvent): DepositOutcome {
  switch (event) {
    case 'no_vet_found':
    case 'admin_cancelled':
      return 'credit';
    case 'farmer_cancelled':
      return from === 'en_route' ? 'forfeit' : 'credit';
    default:
      return 'none';
  }
}

/** A pending payment is queried after this long without a callback. */
export const PAYMENT_STUCK_AFTER_MS = 2 * 60 * 1000;
/** A pending payment with still no outcome after this long is marked failed. */
export const PAYMENT_GIVE_UP_AFTER_MS = 30 * 60 * 1000;
/** A booking still unpaid after this long (and nothing in flight) expires. */
export const UNPAID_BOOKING_EXPIRES_AFTER_MS = 30 * 60 * 1000;
