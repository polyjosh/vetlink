import { and, eq, sql } from 'drizzle-orm';
import type { AppEnv } from '@vetlink/shared';
import type { FieldCrypto } from '../../lib/crypto.js';
import type { Db } from '../client.js';
import {
  adminProfiles,
  animals,
  farmers,
  locations,
  users,
  vetApplications,
  vets,
} from '../schema/index.js';
import {
  SEED_ADMIN_TOTP_SECRET,
  SEED_ANIMAL_ID,
  SEED_APPLICATION_REFS,
  SEED_NATIONAL_IDS,
  SEED_USERS,
} from './fixtures.js';
import { COUNTY, KIAMBU_WARDS } from './kiambu-wards.js';

const SEED_ALLOWED_ENVS: readonly AppEnv[] = ['development', 'test'];

/** The seed creates a super admin with a published TOTP secret: dev and test only. */
export function assertSeedAllowed(appEnv: AppEnv): void {
  if (!SEED_ALLOWED_ENVS.includes(appEnv)) {
    throw new Error(`Refusing to seed with APP_ENV=${appEnv}; dev seed data is dev/test only`);
  }
}

export interface SeedSummary {
  wards: number;
  users: number;
}

// Fixed timestamps keep re-runs deterministic.
const SUBMITTED_AT = new Date('2026-10-01T07:00:00Z');
const DECIDED_AT = new Date('2026-10-02T09:00:00Z');

/**
 * Idempotent dev seed: every row has a fixed key and is upserted, so running it twice is safe.
 * Runs in one transaction.
 */
export async function seed(db: Db, crypto: FieldCrypto): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    await tx
      .insert(locations)
      .values(KIAMBU_WARDS)
      .onConflictDoUpdate({
        target: [locations.county, locations.subCounty, locations.ward],
        set: { lat: sql`excluded.lat`, lng: sql`excluded.lng` },
      });

    const wardId = async (subCounty: string, ward: string): Promise<number> => {
      const [row] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.county, COUNTY),
            eq(locations.subCounty, subCounty),
            eq(locations.ward, ward),
          ),
        );
      if (!row) throw new Error(`Seed ward not found: ${subCounty}/${ward}`);
      return row.id;
    };
    const githunguri = await wardId('Githunguri', 'Githunguri');
    const ikinu = await wardId('Githunguri', 'Ikinu');

    const userRows: (typeof users.$inferInsert)[] = [
      { ...SEED_USERS.farmer, name: 'Demo Farmer', language: 'sw', roles: ['farmer'] },
      { ...SEED_USERS.approvedVet, name: 'Dr. Demo Vet', language: 'en', roles: ['vet'] },
      { ...SEED_USERS.pendingVet, name: 'Demo Paravet', language: 'sw', roles: ['vet'] },
      { ...SEED_USERS.admin, name: 'Dev Admin', language: 'en', roles: ['admin'] },
    ];
    await tx
      .insert(users)
      .values(userRows.map((u) => ({ ...u, consentAt: SUBMITTED_AT })))
      .onConflictDoUpdate({
        target: users.id,
        set: {
          phone: sql`excluded.phone`,
          name: sql`excluded.name`,
          language: sql`excluded.language`,
          roles: sql`excluded.roles`,
          deletedAt: null,
        },
      });

    const admin: typeof adminProfiles.$inferInsert = {
      userId: SEED_USERS.admin.id,
      adminRole: 'super_admin',
      totpSecretEnc: crypto.encrypt(SEED_ADMIN_TOTP_SECRET),
      totpEnabled: true,
      revokedAt: null,
    };
    await tx
      .insert(adminProfiles)
      .values(admin)
      .onConflictDoUpdate({ target: adminProfiles.userId, set: admin });

    const farmer: typeof farmers.$inferInsert = {
      userId: SEED_USERS.farmer.id,
      wardId: githunguri,
      farmNotes: 'Demo farm: green gate opposite the dairy collection centre',
    };
    await tx
      .insert(farmers)
      .values(farmer)
      .onConflictDoUpdate({ target: farmers.userId, set: farmer });

    const cow: typeof animals.$inferInsert = {
      id: SEED_ANIMAL_ID,
      farmerId: SEED_USERS.farmer.id,
      species: 'cattle',
      nameOrTag: 'Wanjiru',
      breed: 'Friesian',
      sex: 'female',
    };
    await tx.insert(animals).values(cow).onConflictDoUpdate({ target: animals.id, set: cow });

    const approvedVet: typeof vets.$inferInsert = {
      userId: SEED_USERS.approvedVet.id,
      type: 'vet',
      kvbRegNo: 'KVB-DEV-0002',
      kvbCategory: 'veterinary_surgeon',
      licenceExpiry: '2027-12-31',
      nationalIdEnc: crypto.encrypt(SEED_NATIONAL_IDS.approvedVet),
      nationalIdHash: crypto.lookupHash(SEED_NATIONAL_IDS.approvedVet),
      qualification: 'BVM',
      qualificationInstitution: 'University of Nairobi',
      qualificationYear: 2015,
      practiceType: 'independent',
      yearsExperience: 10,
      services: ['treatment', 'vaccination', 'artificial_insemination'],
      languages: ['sw', 'en'],
      specialties: ['cattle', 'goat', 'sheep'],
      payoutMpesaPhone: SEED_USERS.approvedVet.phone,
      verificationStatus: 'approved',
      verifiedAt: DECIDED_AT,
      wardId: githunguri,
      serviceRadiusKm: 20,
      baseCallOutFee: 500,
      isAvailable: true,
    };
    const pendingVet: typeof vets.$inferInsert = {
      userId: SEED_USERS.pendingVet.id,
      type: 'paravet',
      nationalIdEnc: crypto.encrypt(SEED_NATIONAL_IDS.pendingVet),
      nationalIdHash: crypto.lookupHash(SEED_NATIONAL_IDS.pendingVet),
      qualification: 'Diploma in Animal Health',
      qualificationInstitution: 'Animal Health and Industry Training Institute',
      qualificationYear: 2021,
      practiceType: 'agrovet',
      practiceName: 'Demo Agrovet',
      yearsExperience: 3,
      services: ['treatment', 'vaccination'],
      languages: ['sw'],
      specialties: ['cattle', 'poultry'],
      verificationStatus: 'submitted',
      verifiedAt: null,
      wardId: ikinu,
      baseCallOutFee: 300,
      isAvailable: false, // unapproved vets can never go online (invariant 2)
    };
    for (const vet of [approvedVet, pendingVet]) {
      await tx.insert(vets).values(vet).onConflictDoUpdate({ target: vets.userId, set: vet });
    }

    const applications: (typeof vetApplications.$inferInsert)[] = [
      {
        vetUserId: SEED_USERS.approvedVet.id,
        reference: SEED_APPLICATION_REFS.approvedVet,
        status: 'approved',
        currentStep: 6,
        submittedAt: SUBMITTED_AT,
        claimedBy: SEED_USERS.admin.id,
        claimedAt: DECIDED_AT,
        decidedBy: SEED_USERS.admin.id,
        decidedAt: DECIDED_AT,
      },
      {
        vetUserId: SEED_USERS.pendingVet.id,
        reference: SEED_APPLICATION_REFS.pendingVet,
        status: 'submitted',
        currentStep: 6,
        submittedAt: SUBMITTED_AT,
        claimedBy: null,
        claimedAt: null,
        decidedBy: null,
        decidedAt: null,
      },
    ];
    for (const app of applications) {
      await tx
        .insert(vetApplications)
        .values(app)
        .onConflictDoUpdate({ target: vetApplications.reference, set: app });
    }

    return { wards: KIAMBU_WARDS.length, users: userRows.length };
  });
}
