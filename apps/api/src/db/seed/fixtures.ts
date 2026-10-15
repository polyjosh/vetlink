// Fixed identities for the dev seed, so re-running the seed updates rows instead of duplicating
// them. Phone numbers are fake-looking (2547000000xx) but Kenya has no reserved fictitious
// range, so they could be real numbers: never send them a live SMS. The API and worker refuse
// to run in production while any of them exists (db/dev-seed-guard.ts). This file ships in the
// production build for that guard; the seed itself (seed.ts, run.ts) does not.

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

/** Obviously fake national ID numbers for the seeded vets. */
export const SEED_NATIONAL_IDS = {
  approvedVet: '00000002',
  pendingVet: '00000003',
} as const;
