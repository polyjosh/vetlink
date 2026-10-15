// Fixed identities for the dev seed, so re-running the seed updates rows instead of duplicating
// them. Phone numbers are obviously fake (2547000000xx). Never use these outside dev/test:
// the API refuses to start in production if any of them exists (db/dev-seed-guard.ts).

export const SEED_USERS = {
  farmer: { id: '00000000-0000-4000-8000-000000000001', phone: '254700000001' },
  approvedVet: { id: '00000000-0000-4000-8000-000000000002', phone: '254700000002' },
  pendingVet: { id: '00000000-0000-4000-8000-000000000003', phone: '254700000003' },
  admin: { id: '00000000-0000-4000-8000-000000000009', phone: '254700000009' },
} as const;

export const SEED_PHONES: string[] = Object.values(SEED_USERS).map((u) => u.phone);

export const SEED_ANIMAL_ID = '00000000-0000-4000-8000-0000000000a1';

export const SEED_APPLICATION_REFS = {
  approvedVet: 'VL-2026-0001',
  pendingVet: 'VL-2026-0002',
} as const;

/**
 * Known base32 TOTP secret for the seeded super admin, printed by the seed so an authenticator
 * app can be set up. Public by design: it only ever exists in dev/test databases.
 */
export const SEED_ADMIN_TOTP_SECRET = 'VETLINKDEVSEEDADMINTOTPSECRETAAA';

/** Obviously fake national ID numbers for the seeded vets. */
export const SEED_NATIONAL_IDS = {
  approvedVet: '00000002',
  pendingVet: '00000003',
} as const;
