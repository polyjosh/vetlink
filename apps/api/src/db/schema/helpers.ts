import { sql, type SQL } from 'drizzle-orm';
import { timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

const SAFE_LITERAL = /^[a-z_]+$/;

function literalList(values: readonly string[]): SQL {
  // CHECK constraints cannot take bind parameters, so the values are inlined. They come from
  // the constant arrays in @vetlink/shared, never from input; the pattern guards against typos.
  for (const v of values) {
    if (!SAFE_LITERAL.test(v)) throw new Error(`Unsafe enum literal: ${v}`);
  }
  return sql.raw(values.map((v) => `'${v}'`).join(', '));
}

/** `column IN ('a', 'b', ...)` for a CHECK constraint. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${literalList(values)})`;
}

/** `column <@ ARRAY['a', 'b', ...]` for a CHECK constraint on a text[] column. */
export function subsetOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} <@ array[${literalList(values)}]::text[]`;
}

/** All timestamps are stored as UTC `timestamptz`. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

export const emptyTextArray = sql`'{}'::text[]`;
export const emptyJson = sql`'{}'::jsonb`;
