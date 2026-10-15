/**
 * M-Pesa Express (STK push) behind one interface (§14), so the payment logic is the same for
 * Daraja sandbox/live and the local mock (`PAYMENTS_MODE`).
 */

export interface StkPushRequest {
  /** Payer, 2547XXXXXXXX. */
  phone: string;
  /** Whole KES. */
  amount: number;
  /** Shown on the customer's phone; at most 12 characters (Daraja AccountReference). */
  accountReference: string;
  /** At most 13 characters (Daraja TransactionDesc). */
  description: string;
}

export interface StkPushAccepted {
  checkoutRequestId: string;
  merchantRequestId: string;
}

/** A transaction outcome, from a callback or a status query. */
export interface StkResult {
  checkoutRequestId: string;
  /** Daraja ResultCode: 0 success, 1032 cancelled by user, others failed. */
  resultCode: number;
  resultDesc: string;
  /** Only callbacks carry these (on success). */
  receipt?: string | undefined;
  amount?: number | undefined;
}

export type StkQueryResult =
  | { state: 'final'; result: StkResult }
  /** M-Pesa has no outcome yet (the customer has not answered). */
  | { state: 'processing' };

export interface PaymentsGateway {
  /** Ask M-Pesa to prompt the customer. Throws if the request is not accepted. */
  stkPush(req: StkPushRequest): Promise<StkPushAccepted>;
  /** Ask M-Pesa for the outcome of a push (used to confirm callbacks and to reconcile). */
  query(checkoutRequestId: string): Promise<StkQueryResult>;
}

export class GatewayError extends Error {
  override name = 'GatewayError';
}

/** Daraja result codes that mean the customer cancelled rather than a failure (§8.6). */
export const CANCELLED_RESULT_CODES: readonly number[] = [1032];
