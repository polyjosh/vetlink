import {
  APPLICATION_STEPS,
  KVB_CATEGORIES,
  PRACTICE_TYPES,
  SPECIES,
  SPOKEN_LANGUAGES,
  VET_SERVICES,
  VET_TYPES,
  normalizePhone,
  type ApplicationStep,
} from '@vetlink/shared';
import { z } from 'zod';
import { practiceFields } from '../vets/practice.js';

/**
 * The wizard's steps (§8.3). Each step validates on autosave (every field optional) and on
 * submit (required fields present). The national ID is accepted only on input: it is stored
 * encrypted with a keyed hash, never as plain JSON.
 */
export const STEP_INPUT = {
  professional_type: z.object({ vetType: z.enum(VET_TYPES) }),
  personal: z.object({
    fullName: z.string().trim().min(3).max(100),
    nationalId: z.string().regex(/^\d{7,9}$/, 'Kenyan ID numbers have 7 to 9 digits'),
    email: z.email().max(200).optional(),
  }),
  credentials: z.object({
    kvbRegNo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9/-]{3,30}$/),
    kvbCategory: z.enum(KVB_CATEGORIES),
    licenceExpiry: z.iso.date(),
    qualification: z.string().trim().min(2).max(100),
    institution: z.string().trim().min(2).max(120),
    yearQualified: z.number().int().min(1960).max(2100),
    supervisingVet: z.string().trim().max(100).optional(),
  }),
  practice: z.object({
    practiceType: z.enum(PRACTICE_TYPES),
    practiceName: z.string().trim().max(100).optional(),
    yearsExperience: z.number().int().min(0).max(60),
    species: z.array(z.enum(SPECIES)).min(1),
    services: z.array(z.enum(VET_SERVICES)).min(1),
    languages: z.array(z.enum(SPOKEN_LANGUAGES)).min(1),
    bio: z.string().trim().max(300).optional(),
  }),
  service_area: z.object({
    wardId: z.number().int().positive(),
    serviceRadiusKm: z.number().int().min(1),
    baseCallOutFee: z.number().int().min(0),
    emergencyCallouts: z.boolean(),
    availabilityHours: z.string().trim().max(100).optional(),
    // §24.3, §24.10: prices, call-outs and premises, working hours.
    ...practiceFields,
  }),
  payout: z.object({
    payoutMpesaPhone: z.string().transform((v, c) => {
      const p = normalizePhone(v);
      if (!p) c.addIssue({ code: 'custom', message: 'not a Kenyan mobile number' });
      return p ?? v;
    }),
  }),
  declaration: z.object({
    acceptTerms: z.literal(true),
    consentVerification: z.literal(true),
    declaration: z.literal(true),
  }),
} as const;

/** Autosave accepts any subset of a step's fields. */
export const STEP_PARTIAL = Object.fromEntries(
  Object.entries(STEP_INPUT).map(([k, s]) => [k, s.partial()]),
) as { [K in ApplicationStep]: ReturnType<(typeof STEP_INPUT)[K]['partial']> };

/** Fields required at submit, per step (stored names: the ID is stored as nationalIdEnc). */
export const REQUIRED_FIELDS: Record<ApplicationStep, readonly string[]> = {
  professional_type: ['vetType'],
  personal: ['fullName', 'nationalIdEnc'],
  credentials: ['kvbRegNo', 'kvbCategory', 'qualification', 'institution', 'yearQualified'],
  practice: ['practiceType', 'yearsExperience', 'species', 'services', 'languages'],
  // Prices per service and premises details are checked by `practiceProblems` (they depend on
  // the services chosen in the practice step).
  // The call-out fee is required only of vets who do call-outs (also in `practiceProblems`).
  service_area: [
    'wardId',
    'serviceRadiusKm',
    'consultationFee',
    'offersCallOuts',
    'hasPremises',
    'workingHours',
  ],
  payout: ['payoutMpesaPhone'],
  declaration: ['acceptTerms', 'consentVerification', 'declaration'],
};

/** Changes to these after approval need review (§8.3: critical fields); the rest apply at once. */
export const CRITICAL_STEPS: readonly ApplicationStep[] = ['personal', 'credentials', 'payout'];

export type StoredData = Partial<Record<ApplicationStep, Record<string, unknown>>>;

export const stepIndex = (step: ApplicationStep) => APPLICATION_STEPS.indexOf(step) + 1;
