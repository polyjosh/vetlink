/**
 * Background jobs. Producers (API, webhooks) call `ctx.jobs.add`; the worker process runs the
 * handlers (BullMQ). Tests use an inline runner so job effects are deterministic.
 */
export interface JobPayloads {
  /** A Daraja STK result (callback or simulated); processed with retries. */
  'payments.stk-result': {
    checkoutRequestId: string;
    resultCode: number;
    resultDesc: string;
    receipt?: string | undefined;
    amount?: number | undefined;
  };
  /** Query stuck payments, fail stale ones, expire unpaid bookings (every minute). */
  'payments.reconcile': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface JobOptions {
  /** Deduplicates: a second job with the same id is ignored while the first exists. */
  jobId?: string;
  delayMs?: number;
}

export interface Jobs {
  add<N extends JobName>(name: N, data: JobPayloads[N], options?: JobOptions): Promise<void>;
}
