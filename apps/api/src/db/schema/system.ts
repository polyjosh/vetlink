import { bigserial, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, emptyJson, timestamptz } from './helpers.js';
import { users } from './identity.js';

export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    // Critical notifications fall back to SMS if the app does not confirm the push (§8.7).
    critical: boolean('critical').notNull().default(false),
    pushSentAt: timestamptz('push_sent_at'),
    pushTicketId: text('push_ticket_id'), // Expo ticket, for receipts
    pushError: text('push_error'),
    smsSentAt: timestamptz('sms_sent_at'),
    readAt: timestamptz('read_at'), // the app confirmed it (also stops the SMS fallback)
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_id_idx').on(t.userId)],
);

export const ussdSessions = pgTable('ussd_sessions', {
  sessionId: text('session_id').primaryKey(),
  phone: text('phone').notNull(),
  state: text('state').notNull(),
  data: jsonb('data').notNull().default(emptyJson),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Every admin action is written here (§17). Append-only. */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(), // vet.approved, payment.refunded, config.changed
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  meta: jsonb('meta'),
  createdAt: createdAt(),
});

/**
 * Runtime settings an admin can change without a deploy (matching weights, radii, waves).
 * Code holds the defaults and the validation; a row here overrides one key.
 */
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
