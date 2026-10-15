import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { handleStkResult, reconcilePayments } from '../modules/payments/service.js';
import type { JobName, JobPayloads } from './types.js';

type Handler<N extends JobName> = (
  ctx: AppContext,
  data: JobPayloads[N],
  log: FastifyBaseLogger,
) => Promise<unknown>;

/** What each job does. The worker (BullMQ) and the inline test runner both dispatch here. */
export const jobHandlers: { [N in JobName]: Handler<N> } = {
  'payments.stk-result': (ctx, data, log) => handleStkResult(ctx, data, 'callback', log),
  'payments.reconcile': (ctx, _data, log) => reconcilePayments(ctx, log),
};

export async function runJob<N extends JobName>(
  ctx: AppContext,
  name: N,
  data: JobPayloads[N],
  log: FastifyBaseLogger,
): Promise<unknown> {
  const handler = jobHandlers[name] as Handler<N>;
  return handler(ctx, data, log);
}
