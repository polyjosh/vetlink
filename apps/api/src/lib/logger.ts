import { stdSerializers, type LoggerOptions } from 'pino';
import { maskPhonesInText } from './phone.js';

// Query parameters on database errors (Drizzle `params`, postgres.js `parameters`) hold phone
// numbers, code hashes and token hashes: never log them.
const SENSITIVE_ERROR_KEYS = new Set(['params', 'parameters', 'args']);

// Drizzle also writes the values into the message (and so the stack): `Failed query: …\nparams: …`.
const PARAMS_LINE = /^params: .*$/gm;

/** Deep-copy a serialized error without parameter values and with phone numbers masked. */
function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return maskPhonesInText(value.replace(PARAMS_LINE, 'params: [REDACTED]'));
  }
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_ERROR_KEYS.has(key))
      .map(([key, v]) => [key, scrub(v, depth + 1)]),
  );
}

/**
 * Errors are logged with their cause chain, but database errors also carry the failing query's
 * values and Postgres `detail` text such as `Key (phone)=(2547…) already exists`.
 */
export function serializeError(err: Error, depth = 0): unknown {
  const serialized = scrub(stdSerializers.err(err)) as Record<string, unknown>;
  // Keep the root cause (e.g. the Postgres error under a Drizzle one), scrubbed the same way.
  if (err.cause instanceof Error && depth < 3) {
    serialized.cause = serializeError(err.cause, depth + 1);
  }
  return serialized;
}

interface RequestLike {
  id?: string;
  method?: string;
  url?: string;
}

/**
 * Structured JSON logs to stdout. Phone numbers, OTPs and tokens must never be logged:
 * query strings are dropped from request URLs, phone-shaped text is masked, and
 * sensitive fields are censored wherever they appear.
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.otp',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.password',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      err: serializeError,
      req(req: RequestLike) {
        return {
          id: req.id,
          method: req.method,
          url: maskPhonesInText((req.url ?? '').split('?')[0] ?? ''),
        };
      },
    },
    hooks: {
      logMethod(args, method) {
        const masked = args.map((a) => (typeof a === 'string' ? maskPhonesInText(a) : a));
        method.apply(this, masked as Parameters<typeof method>);
      },
    },
  };
}
