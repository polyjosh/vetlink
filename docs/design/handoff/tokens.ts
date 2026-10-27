// VetLink design tokens v1, the source of truth for packages/ui-tokens.
// Mobile (Expo) and web (Next.js + Tailwind) both read from here. No magic numbers in screens.

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

// Booking status → chip colours. Keys must match the BookingStatus enum in packages/shared.
// If the enum names differ, map them here; never duplicate the enum.
export const statusTone = {
  searching: { bg: color.warningSoft, fg: color.warning }, // "Finding a vet"
  accepted: { bg: color.infoSoft, fg: color.info },
  en_route: { bg: color.infoSoft, fg: color.info }, // "Vet on the way"
  arrived: { bg: color.infoSoft, fg: color.info },
  completed: { bg: color.successSoft, fg: color.success },
  payment_pending: { bg: color.warningSoft, fg: color.warning },
  no_vet_found: { bg: color.dangerSoft, fg: color.danger },
  cancelled: { bg: color.neutralSoft, fg: color.inkMuted },
} as const;

export const font = {
  family: 'Figtree',
  fallback: 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif',
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' },
} as const;

// [fontSize, lineHeight, weight]
export const type = {
  display: { size: 32, line: 40, weight: '800', tracking: -0.32 },
  title: { size: 24, line: 32, weight: '700' },
  heading: { size: 20, line: 28, weight: '700' },
  body: { size: 16, line: 24, weight: '400' }, // never smaller for body copy on mobile
  small: { size: 14, line: 20, weight: '500' },
  label: { size: 13, line: 16, weight: '700', tracking: 0.78, uppercase: true },
  button: { size: 17, line: 24, weight: '700' },
} as const;

// 4px base scale. space[4] = 16.
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, sheet: 24, pill: 999 } as const;

export const size = {
  touchMin: 48, // every tappable thing
  buttonLg: 56, // primary actions
  buttonMd: 48,
  input: 56,
  chip: 44,
  bottomNav: 72,
  avatar: 52,
} as const;

export const shadow = {
  raised: '0 1px 2px rgba(20,33,26,0.08), 0 4px 12px rgba(20,33,26,0.06)',
  overlay: '0 2px 4px rgba(20,33,26,0.08), 0 12px 32px rgba(20,33,26,0.12)',
} as const;

export const layout = { webMaxWidth: 1200, webGutter: 24, mobileGutter: 20 } as const;
