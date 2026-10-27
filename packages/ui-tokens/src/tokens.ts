import type { BookingStatus } from '@vetlink/shared';

/**
 * VetLink design tokens v1 (docs/design/handoff/tokens.ts): mobile (Expo) and web (Next.js +
 * Tailwind) both read from here. No magic numbers in screens.
 */
export const color = {
  primary: '#1F5F3F',
  primaryPressed: '#174A31',
  primarySoft: '#E4F0E8',
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#CFE3D6',

  accent: '#F2B33D', // urgent CTA, highlights; text on it is always `ink`
  ink: '#14211A',
  inkMuted: '#55625A',
  inkInverseMuted: '#A9BBAF',

  ground: '#F5F6F2', // app background
  surface: '#FFFFFF', // cards, sheets, inputs
  border: '#DCE2DC',
  divider: '#EDEFEC',

  success: '#1E7A46',
  successSoft: '#E4F0E8',
  info: '#1D5FA8',
  infoSoft: '#E3EDF8',
  warning: '#8A5A00',
  warningSoft: '#FDF1D8',
  danger: '#B3261E',
  dangerSoft: '#FBE7E5',
  neutralSoft: '#EDEFEC',
  online: '#4CC27E',
} as const;

export type Tone = 'warning' | 'info' | 'success' | 'danger' | 'neutral';

export const tone: Record<Tone, { bg: string; fg: string }> = {
  warning: { bg: color.warningSoft, fg: color.warning },
  info: { bg: color.infoSoft, fg: color.info },
  success: { bg: color.successSoft, fg: color.success },
  danger: { bg: color.dangerSoft, fg: color.danger },
  neutral: { bg: color.neutralSoft, fg: color.inkMuted },
};

/**
 * Booking status → tone. Keyed by the real enum, so a new status without a tone fails the
 * typecheck. Waiting on someone is warning, a vet on the job is info.
 */
export const statusToneName: Record<BookingStatus, Tone> = {
  pending_payment: 'warning',
  pending: 'warning',
  requested: 'warning',
  awaiting_deposit: 'warning',
  matched: 'info',
  en_route: 'info',
  in_service: 'info',
  done: 'success',
  vet_unavailable: 'danger',
  expired: 'danger',
  cancelled: 'neutral',
};

export const statusTone = Object.fromEntries(
  Object.entries(statusToneName).map(([k, v]) => [k, tone[v]]),
) as Record<BookingStatus, { bg: string; fg: string }>;

export const font = {
  family: 'Figtree',
  fallback: 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif',
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' },
} as const;

export type FontWeight = (typeof font.weight)[keyof typeof font.weight];

/** Type scale: size and line height in px. */
export const type = {
  display: { size: 32, line: 40, weight: '800', tracking: -0.32 },
  title: { size: 24, line: 32, weight: '700' },
  heading: { size: 20, line: 28, weight: '700' },
  body: { size: 16, line: 24, weight: '400' }, // never smaller for body copy on mobile
  small: { size: 14, line: 20, weight: '500' },
  label: { size: 13, line: 16, weight: '700', tracking: 0.78, uppercase: true },
  button: { size: 17, line: 24, weight: '700' },
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, sheet: 24, pill: 999 } as const;

export const size = {
  touchMin: 48, // every tappable thing
  buttonLg: 56, // primary actions
  buttonMd: 48,
  buttonXl: 60, // the vet's Accept
  input: 56,
  chip: 44,
  tile: 72,
  bottomNav: 72,
  navItem: 60,
  avatar: 52,
  icon: 24,
  iconSm: 20,
  border: 1,
  borderStrong: 1.5,
  borderTile: 2,
  focusRing: 4,
  progress: 6,
} as const;

export const shadow = {
  raised: '0 1px 2px rgba(20,33,26,0.08), 0 4px 12px rgba(20,33,26,0.06)',
  overlay: '0 2px 4px rgba(20,33,26,0.08), 0 12px 32px rgba(20,33,26,0.12)',
} as const;

/** React Native equivalents of `shadow` (iOS shadow props + Android elevation). */
export const nativeShadow = {
  raised: {
    shadowColor: color.ink,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  overlay: {
    shadowColor: color.ink,
    shadowOpacity: 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

export const layout = {
  webMaxWidth: 1200,
  webGutter: 24,
  mobileGutter: 20,
  webWrap: 900, // side-by-side panels wrap below this width
  sheetOverlap: 24,
} as const;
