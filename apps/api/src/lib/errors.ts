import type { FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
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
  two_factor_enrolment_closed: 403,
  step_up_required: 401,
  sms_unavailable: 503,
  invalid_transition: 409,
  offer_taken: 409,
  idempotency_key_required: 400,
  idempotency_key_reused: 422,
  vet_not_approved: 403,
  farmer_profile_required: 409,
  already_rated: 409,
  consent_required: 409,
  payment_unavailable: 503,
  application_incomplete: 422,
  application_locked: 409,
  application_claimed: 409,
  upload_invalid: 422,
  photo_invalid: 422,
  vet_photo_required: 409,
  practice_incomplete: 409,
  vet_unavailable_now: 409,
  at_capacity: 409,
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
    if (hasZodFastifySchemaValidationErrors(err)) {
      // Same shape as parseInput: the failing fields, e.g. `device.platform`.
      const fields = err.validation.map(
        (v) => v.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(root)',
      );
      return reply.code(400).send(errorBody('invalid_request', { fields: [...new Set(fields)] }));
    }
    if (isResponseSerializationError(err)) {
      // A handler returned something its response schema does not allow: a bug, never sent.
      request.log.error({ err, url: err.url }, 'response did not match its schema');
      return reply.code(500).send(errorBody('internal_error'));
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
