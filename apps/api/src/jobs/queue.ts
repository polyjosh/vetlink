import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { runJob } from './handlers.js';
import type { JobName, JobPayloads, Jobs } from './types.js';

export const QUEUE_NAME = 'vetlink';

/** Retries for jobs that touch external systems (M-Pesa) or race other updates. */
const DEFAULT_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Producer side: the API enqueues, the worker runs. */
export function bullJobs(
  connection: ConnectionOptions,
): Jobs & { queue: Queue; close(): Promise<void> } {
  const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return {
    queue,
    async add(name, data, options = {}) {
      await queue.add(name, data, {
        ...(options.jobId && { jobId: options.jobId }),
        ...(options.delayMs && { delay: options.delayMs }),
      });
    },
    close: () => queue.close(),
  };
}

/** Repeating jobs, (re)declared at worker startup. Idempotent. */
export async function scheduleRepeatingJobs(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    'payments.reconcile',
    { every: 60_000 },
    { name: 'payments.reconcile', data: {} },
  );
}

export function startWorker(
  ctx: AppContext,
  connection: ConnectionOptions,
  log: FastifyBaseLogger,
): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => runJob(ctx, job.name as JobName, job.data as JobPayloads[JobName], log),
    { connection, concurrency: 5 },
  );
  worker.on('failed', (job, err) =>
    log.warn({ err, job: job?.name, attempts: job?.attemptsMade }, 'job failed'),
  );
  return worker;
}

/** A job the inline runner is holding: due now, delayed, or waiting to retry. */
interface HeldJob {
  name: JobName;
  data: unknown;
  dueAt: number;
  attempts: number;
}

/**
 * Tests (and anywhere without Redis): BullMQ's semantics, in-process. Jobs without a delay run
 * at once; delayed jobs wait until `runDue()` is called with the clock past their time; a failed
 * job is retried with backoff (up to the same 6 attempts); a `jobId` already seen is ignored,
 * like BullMQ ignoring a duplicate id while the job is kept.
 */
export function inlineJobs(
  getCtx: () => AppContext,
  getLog: () => FastifyBaseLogger,
): Jobs & {
  ran: { name: JobName; data: unknown }[];
  failed: { name: JobName; error: unknown }[];
  pending(): HeldJob[];
  runDue(): Promise<number>;
} {
  const ran: { name: JobName; data: unknown }[] = [];
  const failed: { name: JobName; error: unknown }[] = [];
  const held: HeldJob[] = [];
  const seen = new Set<string>();
  const now = () => getCtx().clock().getTime();

  async function attempt(job: HeldJob): Promise<void> {
    job.attempts += 1;
    try {
      ran.push({ name: job.name, data: job.data });
      await runJob(getCtx(), job.name, job.data as JobPayloads[JobName], getLog());
    } catch (error) {
      if (job.attempts < DEFAULT_JOB_OPTIONS.attempts) {
        held.push({
          ...job,
          dueAt: now() + DEFAULT_JOB_OPTIONS.backoff.delay * 2 ** (job.attempts - 1),
        });
      } else {
        failed.push({ name: job.name, error });
      }
    }
  }

  return {
    ran,
    failed,
    pending: () => [...held],
    async add(name, data, options = {}) {
      if (options.jobId) {
        if (seen.has(options.jobId)) return;
        seen.add(options.jobId);
      }
      const job: HeldJob = { name, data, dueAt: now() + (options.delayMs ?? 0), attempts: 0 };
      if (options.delayMs) held.push(job);
      else await attempt(job);
    },
    async runDue() {
      let count = 0;
      for (;;) {
        held.sort((a, b) => a.dueAt - b.dueAt);
        const next = held[0];
        if (!next || next.dueAt > now()) return count;
        held.shift();
        count += 1;
        await attempt(next);
      }
    },
  };
}
