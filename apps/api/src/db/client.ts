import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: 5,
    onnotice: () => {}, // "relation already exists, skipping" etc. from migrations
  });
  return { db: drizzle(sql, { schema }), sql, close: () => sql.end({ timeout: 5 }) };
}
