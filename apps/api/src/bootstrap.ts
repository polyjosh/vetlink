import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { createContext, type AppContext } from './context.js';
import { createDb } from './db/client.js';
import { bullJobs } from './jobs/queue.js';
import { redisCounters } from './lib/counters.js';
import { createSmsSender } from './lib/sms.js';
import { darajaGateway } from './modules/payments/daraja.js';
import type { PaymentsGateway } from './modules/payments/gateway.js';
import { mockGateway } from './modules/payments/mock.js';

export interface Runtime {
  ctx: AppContext;
  /** BullMQ needs its own connection with no per-command retry limit. */
  queueConnection: Redis;
  close(): Promise<void>;
}

/** The services the API and the worker share, built from config. */
export function buildRuntime(config: Config, log: Logger): Runtime {
  const db = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  const queueConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const jobs = bullJobs(queueConnection);

  let payments: PaymentsGateway;
  if (config.PAYMENTS_MODE === 'mock') {
    // Simulated callbacks go through the same job as real Daraja callbacks.
    payments = mockGateway({
      deliver: (result) =>
        jobs.add('payments.stk-result', result, {
          jobId: `stk-${result.checkoutRequestId}-${result.resultCode}`,
        }),
    });
  } else {
    const token = encodeURIComponent(config.WEBHOOK_SECRET ?? '');
    payments = darajaGateway({
      env: config.PAYMENTS_MODE,
      consumerKey: config.DARAJA_CONSUMER_KEY ?? '',
      consumerSecret: config.DARAJA_CONSUMER_SECRET ?? '',
      shortcode: config.DARAJA_SHORTCODE ?? '',
      passkey: config.DARAJA_PASSKEY ?? '',
      callbackUrl: new URL(`/webhooks/mpesa?token=${token}`, config.PUBLIC_BASE_URL).toString(),
    });
  }

  const ctx = createContext({
    db: db.db,
    counters: redisCounters(redis),
    sms: createSmsSender(config.SMS_MODE, log, config.APP_ENV),
    payments,
    jobs,
    dataEncryptionKey: config.DATA_ENCRYPTION_KEY,
    jwtSecret: config.JWT_SECRET,
    otpFixedCode: config.OTP_FIXED_CODE,
  });

  return {
    ctx,
    queueConnection,
    close: async () => {
      await jobs.close();
      queueConnection.disconnect();
      redis.disconnect();
      await db.close();
    },
  };
}
