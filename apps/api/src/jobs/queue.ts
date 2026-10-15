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

/**
 * Tests (and anywhere without Redis): run each job immediately, in-process, and surface errors.
 * `delayMs` is ignored: tests drive time themselves.
 */
export function inlineJobs(
  getCtx: () => AppContext,
  getLog: () => FastifyBaseLogger,
): Jobs & { ran: { name: JobName; data: unknown }[] } {
  const ran: { name: JobName; data: unknown }[] = [];
  return {
    ran,
    async add(name, data) {
      ran.push({ name, data });
      await runJob(getCtx(), name, data, getLog());
    },
  };
}
