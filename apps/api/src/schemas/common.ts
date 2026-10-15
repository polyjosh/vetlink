import { z } from 'zod';
import { ERROR_STATUS, type ErrorCode } from '../lib/errors.js';

/** Compile-time check that an API schema and a shared TypeScript type describe the same data. */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export function assertSameType<T extends true>(proof?: T): void {
  void proof; // compile-time only: the type argument is the check
}

/** Register a schema as a named OpenAPI component (and a named type in the generated client). */
export function named<S extends z.ZodType>(schema: S, id: string): S {
  z.globalRegistry.add(schema, { id });
  return schema;
}

export const errorSchema = named(
  z.object({
    code: z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]),
    message_key: z.string().describe('i18n key, e.g. errors.otp_invalid'),
    details: z.record(z.string(), z.unknown()),
  }),
  'Error',
);

const ERROR_STATUSES = [400, 401, 403, 404, 409, 410, 422, 429, 500, 503] as const;

/** A route's success responses plus the standard error body for every error status. */
export function responses<R extends Record<number, z.ZodType>>(success: R) {
  const errors = Object.fromEntries(ERROR_STATUSES.map((s) => [s, errorSchema])) as Record<
    (typeof ERROR_STATUSES)[number],
    typeof errorSchema
  >;
  return { ...errors, ...success };
}

export const noContent = z.null().describe('No content');

export const intId = z.coerce.number().int().positive().max(2_147_483_647);
