/** Deployment environments. Dev-only shortcuts must be rejected when this is `production`. */
export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** `log` prints SMS/OTP to the API logs instead of sending (dev only). */
export const SMS_MODES = ['log', 'sandbox', 'live'] as const;
export type SmsMode = (typeof SMS_MODES)[number];

/** `mock` simulates STK push outcomes locally (dev only). */
export const PAYMENTS_MODES = ['mock', 'sandbox', 'live'] as const;
export type PaymentsMode = (typeof PAYMENTS_MODES)[number];
