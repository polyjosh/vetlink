import type { LoggerOptions } from 'pino';
import { maskPhonesInText } from './phone.js';

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
