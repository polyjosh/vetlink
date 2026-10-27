import type {
  PaymentsGateway,
  StkPushAccepted,
  StkPushRequest,
  StkQueryResult,
  StkResult,
} from '../../src/modules/payments/gateway.js';

/**
 * A scriptable M-Pesa: records every push, and answers queries from `outcomes` (what M-Pesa
 * "really" did), so tests can play callbacks that are late, duplicated, forged, or missing.
 */
export class FakeGateway implements PaymentsGateway {
  pushes: (StkPushRequest & StkPushAccepted)[] = [];
  /** checkoutRequestId → the true outcome; absent = still processing. */
  outcomes = new Map<string, StkResult>();
  /** Make the next pushes fail (M-Pesa down). */
  rejectPushes = false;
  queries = 0;
  private seq = 0;

  async stkPush(req: StkPushRequest): Promise<StkPushAccepted> {
    if (this.rejectPushes) throw new Error('fake: M-Pesa unavailable');
    this.seq += 1;
    const accepted = {
      checkoutRequestId: `ws_CO_TEST_${this.seq}_${Date.now()}`,
      merchantRequestId: `MR-${this.seq}`,
    };
    this.pushes.push({ ...req, ...accepted });
    return accepted;
  }

  async query(checkoutRequestId: string): Promise<StkQueryResult> {
    this.queries += 1;
    const outcome = this.outcomes.get(checkoutRequestId);
    return outcome
      ? {
          state: 'final',
          result: {
            checkoutRequestId,
            resultCode: outcome.resultCode,
            resultDesc: outcome.resultDesc,
          },
        }
      : { state: 'processing' };
  }

  last(): StkPushRequest & StkPushAccepted {
    const p = this.pushes.at(-1);
    if (!p) throw new Error('no STK push sent');
    return p;
  }
}
