'use client';

import type { SessionRole } from '@vetlink/shared';

const KEY = 'vl_last_role';

/** The last role used on this browser (multi-role users land where they left off, §8.0). */
export function lastRole(): SessionRole | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'farmer' || v === 'vet' || v === 'admin' ? v : null;
  } catch {
    return null;
  }
}

export function rememberRole(role: SessionRole): void {
  try {
    localStorage.setItem(KEY, role);
  } catch {
    // ignore
  }
}

/** Where each resolver destination lives in this app. */
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
