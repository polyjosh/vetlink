import {
  PRACTICE_TYPES,
  SPECIES,
  VET_SERVICES,
  VET_TYPES,
  type VetDocumentKind,
  type VetType,
} from './domain.js';

/** The vet application wizard (§8.3): the same 7 steps on mobile and web. */
export const APPLICATION_STEPS = [
  'professional_type',
  'personal',
  'credentials',
  'practice',
  'service_area',
  'payout',
  'declaration',
] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];

/** Documents required before submitting, by professional type. */
export const REQUIRED_DOCUMENTS: Record<VetType, readonly VetDocumentKind[]> = {
  vet: ['profile_photo', 'id_front', 'id_back', 'certificate', 'licence'],
  paravet: ['profile_photo', 'id_front', 'id_back', 'training_cert'],
};

export const KVB_CATEGORIES = [
  'veterinary_surgeon',
  'veterinary_paraprofessional',
  'animal_health_assistant',
] as const;
export type KvbCategory = (typeof KVB_CATEGORIES)[number];

/** Languages a vet speaks (shown to farmers). */
export const SPOKEN_LANGUAGES = ['sw', 'en', 'ki', 'luo', 'kam', 'kln', 'other'] as const;
export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];

/** Reviewer reason templates (bilingual text in i18n `application.reasons`). */
export const APPLICATION_REASONS = [
  'id_unclear',
  'id_mismatch',
  'photo_unclear',
  'certificate_unclear',
  'licence_unclear',
  'licence_expired',
  'kvb_unverifiable',
  'fraudulent_documents',
  'outside_service_area',
  'fee_out_of_band',
  'duplicate_account',
  'other',
] as const;
export type ApplicationReason = (typeof APPLICATION_REASONS)[number];

export const APPLICATION_DECISIONS = ['approve', 'request_changes', 'reject'] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

/** Upload limits for vet documents (§8.3: JPG, PNG, PDF; enforce size). */
export const DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Target review time shown to applicants (placeholder; Open Question 21.16). */
export const REVIEW_TARGET_HOURS = 48;

/** How a wizard field is entered (the same on web and mobile). */
export type ApplicationFieldKind =
  'text' | 'textarea' | 'int' | 'date' | 'enum' | 'multi' | 'bool' | 'ward' | 'tel' | 'email';

export interface ApplicationField {
  name: string;
  kind: ApplicationFieldKind;
  options?: readonly string[];
  /** Only asked of veterinary surgeons (not paravets). */
  vetOnly?: boolean;
}

/** The wizard's fields per step (§8.3). Names match the API step schemas. */
export const APPLICATION_FIELDS: Record<ApplicationStep, readonly ApplicationField[]> = {
  professional_type: [{ name: 'vetType', kind: 'enum', options: VET_TYPES }],
  personal: [
    { name: 'fullName', kind: 'text' },
    { name: 'nationalId', kind: 'text' },
    { name: 'email', kind: 'email' },
  ],
  credentials: [
    { name: 'kvbRegNo', kind: 'text' },
    { name: 'kvbCategory', kind: 'enum', options: KVB_CATEGORIES },
    { name: 'licenceExpiry', kind: 'date', vetOnly: true },
    { name: 'qualification', kind: 'text' },
    { name: 'institution', kind: 'text' },
    { name: 'yearQualified', kind: 'int' },
    { name: 'supervisingVet', kind: 'text' },
  ],
  practice: [
    { name: 'practiceType', kind: 'enum', options: PRACTICE_TYPES },
    { name: 'practiceName', kind: 'text' },
    { name: 'yearsExperience', kind: 'int' },
    { name: 'species', kind: 'multi', options: SPECIES },
    { name: 'services', kind: 'multi', options: VET_SERVICES },
    { name: 'languages', kind: 'multi', options: SPOKEN_LANGUAGES },
    { name: 'bio', kind: 'textarea' },
  ],
  service_area: [
    { name: 'wardId', kind: 'ward' },
    { name: 'serviceRadiusKm', kind: 'int' },
    { name: 'baseCallOutFee', kind: 'int' },
    { name: 'emergencyCallouts', kind: 'bool' },
    { name: 'availabilityHours', kind: 'text' },
  ],
  payout: [{ name: 'payoutMpesaPhone', kind: 'tel' }],
  declaration: [
    { name: 'acceptTerms', kind: 'bool' },
    { name: 'consentVerification', kind: 'bool' },
    { name: 'declaration', kind: 'bool' },
  ],
};
