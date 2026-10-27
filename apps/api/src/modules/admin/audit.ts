import type { Db } from '../../db/client.js';
import { auditLog } from '../../db/schema/index.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string; // dotted, e.g. admin.2fa_failed, vet.approved
  entity: string;
  entityId: string | null;
  /** Never put phone numbers, codes, or secrets here. */
  meta?: Record<string, unknown>;
}

/** Append to `audit_log` (§17). Every admin action and admin auth event goes through here. */
export async function audit(db: Db, entry: AuditEntry, at: Date): Promise<void> {
  await db.insert(auditLog).values({ ...entry, meta: entry.meta ?? null, createdAt: at });
}
