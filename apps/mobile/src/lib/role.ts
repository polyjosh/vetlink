import type { SessionRole } from '@vetlink/shared';
import { kv } from './storage';

const KEY = 'last_role';

/** The last role used on this phone (multi-role users land where they left off, §8.0). */
export function lastRole(): SessionRole | null {
  const v = kv.get(KEY);
  return v === 'farmer' || v === 'vet' || v === 'admin' ? v : null;
}

export function rememberRole(role: SessionRole): void {
  kv.set(KEY, role);
}

/** Resolver destinations; the same paths as the web app. */
export const ROUTE_PATHS = {
  onboarding: '/onboarding',
  farmer_home: '/farmer',
  vet_application: '/vet/application',
  vet_under_review: '/vet/status',
  vet_changes_requested: '/vet/status',
  vet_blocked: '/vet/status',
  vet_home: '/vet',
  admin_2fa: '/admin/verify',
  admin_2fa_setup: '/admin/verify',
  admin_home: '/admin',
} as const;
