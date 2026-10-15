import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Locale } from '@vetlink/i18n';
import { adminPermissions, type MeResponse, type UserRole, type VetType } from '@vetlink/shared';
import type { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  adminProfiles,
  animals,
  authSessions,
  bookings,
  farmers,
  locations,
  treatments,
  users,
  vets,
} from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { ADMIN_2FA_TTL_MS, isRecent, sessionRoles } from '../auth/access.js';
import type {
  animal,
  animalBody,
  animalHistory,
  farmerProfile,
  farmerProfileBody,
} from './schemas.js';

/** Everything clients route on (§8.0), read fresh from the database. */
export async function loadMe(
  ctx: AppContext,
  userId: string,
  sessionId: string,
): Promise<MeResponse> {
  const [row] = await ctx.db
    .select({
      phone: users.phone,
      name: users.name,
      language: users.language,
      roles: users.roles,
      consentAt: users.consentAt,
      verificationStatus: vets.verificationStatus,
      adminRole: adminProfiles.adminRole,
      adminRevokedAt: adminProfiles.revokedAt,
      totpEnabled: adminProfiles.totpEnabled,
      mfaVerifiedAt: authSessions.mfaVerifiedAt,
    })
    .from(users)
    .leftJoin(vets, eq(vets.userId, users.id))
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .leftJoin(authSessions, eq(authSessions.id, sessionId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row?.phone) throw new DomainError('not_found');
  const isAdmin = row.adminRole !== null && row.adminRevokedAt === null;
  return {
    id: userId,
    phone: row.phone,
    name: row.name,
    language: row.language,
    roles: sessionRoles(row.roles, isAdmin),
    onboarding: { consented: row.consentAt !== null, roleChosen: row.roles.length > 0 },
    vet:
      row.roles.includes('vet') && row.verificationStatus
        ? { verificationStatus: row.verificationStatus }
        : null,
    admin:
      isAdmin && row.adminRole
        ? {
            role: row.adminRole,
            permissions: adminPermissions(row.adminRole),
            totpEnabled: row.totpEnabled ?? false,
            twoFactorVerified:
              (row.totpEnabled ?? false) &&
              isRecent(row.mfaVerifiedAt, ADMIN_2FA_TTL_MS, ctx.clock()),
          }
        : null,
  };
}

export async function updateMe(
  ctx: AppContext,
  userId: string,
  input: { name?: string | undefined; language?: Locale | undefined },
): Promise<void> {
  await ctx.db
    .update(users)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
    })
    .where(eq(users.id, userId));
}

/** Record data-protection consent (§17). Idempotent: the first consent time is kept. */
export async function giveConsent(ctx: AppContext, userId: string): Promise<void> {
  await ctx.db
    .update(users)
    .set({ consentAt: ctx.clock() })
    .where(and(eq(users.id, userId), isNull(users.consentAt)));
}

/**
 * Self-service role choice: farmer or vet/paravet, never admin (§8.0). Needs consent first.
 * Idempotent. A vet starts in `draft` and receives nothing until approved (invariant 2).
 */
export async function chooseRole(
  ctx: AppContext,
  userId: string,
  choice: { role: 'farmer' } | { role: 'vet'; vetType: VetType },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .select({ roles: users.roles, consentAt: users.consentAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new DomainError('not_found');
    if (!user.consentAt) throw new DomainError('consent_required');
    if (!user.roles.includes(choice.role)) {
      const roles: UserRole[] = [...user.roles, choice.role];
      await tx.update(users).set({ roles }).where(eq(users.id, userId));
    }
    if (choice.role === 'farmer') {
      await tx.insert(farmers).values({ userId }).onConflictDoNothing();
    } else {
      await tx
        .insert(vets)
        .values({ userId, type: choice.vetType, verificationStatus: 'draft' })
        .onConflictDoNothing();
    }
  });
}

type FarmerProfile = z.infer<typeof farmerProfile>;

export async function getFarmerProfile(ctx: AppContext, userId: string): Promise<FarmerProfile> {
  const [row] = await ctx.db
    .select({ farmer: farmers, ward: locations })
    .from(farmers)
    .leftJoin(locations, eq(locations.id, farmers.wardId))
    .where(eq(farmers.userId, userId))
    .limit(1);
  if (!row) throw new DomainError('farmer_profile_required');
  return {
    ward: row.ward
      ? {
          id: row.ward.id,
          ward: row.ward.ward,
          subCounty: row.ward.subCounty,
          county: row.ward.county,
        }
      : null,
    farmNotes: row.farmer.farmNotes,
    farmLat: row.farmer.farmLat,
    farmLng: row.farmer.farmLng,
  };
}

export async function updateFarmerProfile(
  ctx: AppContext,
  userId: string,
  input: z.infer<typeof farmerProfileBody>,
): Promise<FarmerProfile> {
  const [ward] = await ctx.db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, input.wardId))
    .limit(1);
  if (!ward) throw new DomainError('invalid_request', { fields: ['wardId'] });
  const updated = await ctx.db
    .update(farmers)
    .set({
      wardId: input.wardId,
      ...(input.farmNotes !== undefined && { farmNotes: input.farmNotes }),
      ...(input.farmLat !== undefined && { farmLat: input.farmLat }),
      ...(input.farmLng !== undefined && { farmLng: input.farmLng }),
    })
    .where(eq(farmers.userId, userId))
    .returning({ userId: farmers.userId });
  if (updated.length === 0) throw new DomainError('farmer_profile_required');
  return getFarmerProfile(ctx, userId);
}

export async function listCounties(ctx: AppContext): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ county: locations.county })
    .from(locations)
    .orderBy(asc(locations.county));
  return rows.map((r) => r.county);
}

export async function listWards(ctx: AppContext, county: string) {
  const rows = await ctx.db
    .select()
    .from(locations)
    .where(eq(locations.county, county))
    .orderBy(asc(locations.subCounty), asc(locations.ward));
  return rows.map((r) => ({ id: r.id, ward: r.ward, subCounty: r.subCounty, county: r.county }));
}

type AnimalView = z.infer<typeof animal>;
const animalView = (a: typeof animals.$inferSelect): AnimalView => ({
  id: a.id,
  species: a.species,
  nameOrTag: a.nameOrTag,
  breed: a.breed,
  sex: a.sex,
  dob: a.dob,
});

async function requireFarmer(ctx: AppContext, userId: string): Promise<void> {
  const [f] = await ctx.db
    .select({ userId: farmers.userId })
    .from(farmers)
    .where(eq(farmers.userId, userId))
    .limit(1);
  if (!f) throw new DomainError('farmer_profile_required');
}

export async function listAnimals(ctx: AppContext, farmerId: string): Promise<AnimalView[]> {
  const rows = await ctx.db
    .select()
    .from(animals)
    .where(eq(animals.farmerId, farmerId))
    .orderBy(asc(animals.nameOrTag));
  return rows.map(animalView);
}

export async function addAnimal(
  ctx: AppContext,
  farmerId: string,
  input: z.infer<typeof animalBody>,
): Promise<AnimalView> {
  await requireFarmer(ctx, farmerId);
  const [row] = await ctx.db
    .insert(animals)
    .values({
      farmerId,
      species: input.species,
      nameOrTag: input.nameOrTag ?? null,
      breed: input.breed ?? null,
      sex: input.sex ?? null,
      dob: input.dob ?? null,
    })
    .returning();
  if (!row) throw new Error('animal insert failed');
  return animalView(row);
}

/** One animal and its visits (bookings and treatments). Owner only; others get not_found. */
export async function animalWithHistory(
  ctx: AppContext,
  farmerId: string,
  animalId: string,
): Promise<z.infer<typeof animalHistory>> {
  const [a] = await ctx.db
    .select()
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.farmerId, farmerId)))
    .limit(1);
  if (!a) throw new DomainError('not_found');
  const visits = await ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.animalId, animalId), eq(bookings.farmerId, farmerId)))
    .orderBy(desc(bookings.id));
  const treatmentRows = visits.length
    ? await ctx.db
        .select()
        .from(treatments)
        .where(
          inArray(
            treatments.bookingId,
            visits.map((v) => v.id),
          ),
        )
    : [];
  const byBooking = new Map(treatmentRows.map((t) => [t.bookingId, t]));
  return {
    animal: animalView(a),
    visits: visits.map((v) => {
      const t = byBooking.get(v.id);
      return {
        bookingId: v.id,
        status: v.status,
        problemType: v.problemType,
        createdAt: v.createdAt.toISOString(),
        completedAt: v.completedAt ? v.completedAt.toISOString() : null,
        treatment: t
          ? { diagnosis: t.diagnosis, drugsUsed: t.drugsUsed, followUpDate: t.followUpDate }
          : null,
      };
    }),
  };
}
