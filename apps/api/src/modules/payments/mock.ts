import { randomUUID } from 'node:crypto';
import type { PaymentsGateway, StkQueryResult, StkResult } from './gateway.js';

/**
 * `PAYMENTS_MODE=mock` (dev only; config refuses it in production). The phone number's last
 * digit chooses what happens, so every path can be tried locally:
 *   …9  the customer cancels (ResultCode 1032)
 *   …8  the callback never arrives; reconciliation finds the payment succeeded via query
 *   …7  the push is rejected outright (M-Pesa unavailable)
 *   else the customer pays; the callback arrives after `callbackDelayMs`
 */
export function mockGateway(options: {
  /** Delivers a simulated Daraja callback, through the same handler as the real webhook. */
  deliver?: (result: StkResult) => Promise<void>;
  callbackDelayMs?: number;
}): PaymentsGateway {
  const outcomes = new Map<string, StkResult>();
  return {
    async stkPush(req) {
      const last = req.phone.at(-1);
      if (last === '7') throw new Error('mock: STK push rejected');
      const checkoutRequestId = `ws_CO_MOCK_${randomUUID()}`;
      const result: StkResult =
        last === '9'
          ? { checkoutRequestId, resultCode: 1032, resultDesc: 'Request cancelled by user' }
          : {
              checkoutRequestId,
              resultCode: 0,
              resultDesc: 'The service request is processed successfully.',
              receipt: `MOCK${randomUUID().slice(0, 6).toUpperCase()}`,
              amount: req.amount,
            };
      outcomes.set(checkoutRequestId, result);
      if (last !== '8' && options.deliver) {
        const deliver = options.deliver;
        setTimeout(() => void deliver(result).catch(() => {}), options.callbackDelayMs ?? 3000);
      }
      return { checkoutRequestId, merchantRequestId: `MOCK-${randomUUID().slice(0, 8)}` };
    },
    async query(checkoutRequestId): Promise<StkQueryResult> {
      const result = outcomes.get(checkoutRequestId);
      // Unknown here (another process sent it): report success, as the "…8" path expects.
      return {
        state: 'final',
        result: result
          ? { checkoutRequestId, resultCode: result.resultCode, resultDesc: result.resultDesc }
          : { checkoutRequestId, resultCode: 0, resultDesc: 'Mock: processed' },
      };
    },
  };
}
