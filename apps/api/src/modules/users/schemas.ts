import {
  ADMIN_ROLES,
  ANIMAL_SEXES,
  BOOKING_STATUSES,
  PHOTO_REJECT_REASONS,
  PROBLEM_TYPES,
  SESSION_ROLES,
  SPECIES,
  THEMES,
  usernameProblem,
  VERIFICATION_STATUSES,
  VET_TYPES,
  type MeResponse,
} from '@vetlink/shared';
import { LOCALES } from '@vetlink/i18n';
import { z } from 'zod';
import { assertSameType, named, type Equals } from '../../schemas/common.js';

export const me = named(
  z.object({
    id: z.string(),
    phone: z.string(),
    name: z.string().nullable(),
    displayName: z.string().nullable(),
    language: z.string(),
    theme: z.enum(THEMES),
    photo: z.object({
      url: z.string().nullable(),
      review: z
        .discriminatedUnion('status', [
          z.object({ status: z.literal('pending'), url: z.string() }),
          z.object({ status: z.literal('rejected'), reason: z.enum(PHOTO_REJECT_REASONS) }),
        ])
        .nullable()
        .describe(
          "A vet's new photo waiting for review, or the reason the last one was turned down",
        ),
    }),
    roles: z.array(z.enum(SESSION_ROLES)),
    onboarding: z.object({ consented: z.boolean(), roleChosen: z.boolean() }),
    vet: z.object({ verificationStatus: z.enum(VERIFICATION_STATUSES) }).nullable(),
    admin: z
      .object({
        role: z.enum(ADMIN_ROLES),
        permissions: z.array(z.enum(ADMIN_ROLES)),
        totpEnabled: z.boolean(),
        twoFactorVerified: z.boolean(),
      })
      .nullable(),
  }),
  'Me',
);
assertSameType<Equals<z.infer<typeof me>, MeResponse>>();

/** A display name only, never a login (§24.1). `null` clears it. */
export const displayNameField = z
  .string()
  .trim()
  .superRefine((v, c) => {
    const problem = usernameProblem(v);
    if (problem) c.addIssue({ code: 'custom', message: problem });
  });

export const updateMeBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    displayName: displayNameField.nullable().optional(),
    language: z.enum(LOCALES).optional(),
    theme: z.enum(THEMES).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to update');

export const chooseRoleBody = z.discriminatedUnion('role', [
  z.object({ role: z.literal('farmer') }),
  z.object({ role: z.literal('vet'), vetType: z.enum(VET_TYPES) }),
]);

export const wardView = named(
  z.object({ id: z.number().int(), ward: z.string(), subCounty: z.string(), county: z.string() }),
  'Ward',
);

export const farmerProfile = named(
  z.object({
    ward: wardView.nullable(),
    farmNotes: z.string().nullable(),
    farmLat: z.number().nullable(),
    farmLng: z.number().nullable(),
  }),
  'FarmerProfile',
);

export const farmerProfileBody = z.object({
  wardId: z.number().int().positive(),
  farmNotes: z.string().trim().max(300).nullable().optional(),
  farmLat: z.number().min(-5).max(6).nullable().optional(),
  farmLng: z.number().min(33).max(42.5).nullable().optional(),
});

export const animal = named(
  z.object({
    id: z.string(),
    species: z.enum(SPECIES),
    nameOrTag: z.string().nullable(),
    breed: z.string().nullable(),
    sex: z.enum(ANIMAL_SEXES).nullable(),
    dob: z.string().nullable().describe('YYYY-MM-DD'),
    photoUrl: z
      .string()
      .nullable()
      .describe('Short-lived link; null means show the species picture'),
  }),
  'Animal',
);

export const animalBody = z.object({
  species: z.enum(SPECIES),
  nameOrTag: z.string().trim().min(1).max(60).optional(),
  breed: z.string().trim().max(60).optional(),
  sex: z.enum(ANIMAL_SEXES).optional(),
  dob: z.iso.date().optional(),
});

/** Edit an animal; `null` clears an optional field. The species is fixed once added. */
export const animalUpdateBody = z
  .object({
    nameOrTag: z.string().trim().min(1).max(60).nullable().optional(),
    breed: z.string().trim().max(60).nullable().optional(),
    sex: z.enum(ANIMAL_SEXES).nullable().optional(),
    dob: z.iso.date().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to update');

export const animalHistory = named(
  z.object({
    animal,
    visits: z.array(
      z.object({
        bookingId: z.number().int(),
        status: z.enum(BOOKING_STATUSES),
        problemType: z.enum(PROBLEM_TYPES),
        createdAt: z.string(),
        completedAt: z.string().nullable(),
        treatment: z
          .object({
            diagnosis: z.string().nullable(),
            drugsUsed: z.string().nullable(),
            followUpDate: z.string().nullable(),
          })
          .nullable(),
      }),
    ),
  }),
  'AnimalHistory',
);
