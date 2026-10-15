import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';

/** Every error code the API returns, with its HTTP status. `message_key` is `errors.<code>`. */
export const ERROR_STATUS = {
  invalid_request: 400,
  not_found: 404,
  internal_error: 500,
  unauthenticated: 401,
  forbidden: 403,
  invalid_phone: 400,
  otp_invalid: 400,
  otp_expired: 400,
  rate_limited: 429,
  account_locked: 429,
  refresh_invalid: 401,
  two_factor_required: 401,
  two_factor_setup_required: 403,
  two_factor_invalid: 401,
  two_factor_locked: 429,
  two_factor_already_enabled: 409,
  step_up_required: 401,
  sms_unavailable: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

/** A typed domain error. Adapters map it to their channel (HTTP here; USSD/SMS later). */
export class DomainError extends Error {
  override name = 'DomainError';
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.status = ERROR_STATUS[code];
  }
}

export function errorBody(code: ErrorCode, details?: Record<string, unknown>) {
  return { code, message_key: `errors.${code}`, details: details ?? {} };
}

/** Validate external input at the boundary. Throws `invalid_request` with the failing fields. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainError('invalid_request', {
      fields: result.error.issues.map((i) => i.path.join('.') || '(root)'),
    });
  }
  return result.data;
}

/** Map every error to `{ code, message_key, details }`. Never leaks internals. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send(errorBody(err.code, err.details));
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Fastify's own client errors: malformed JSON, wrong content type, body too large.
      return reply.code(400).send(errorBody('invalid_request'));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('internal_error'));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(errorBody('not_found')));
}
