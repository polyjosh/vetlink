/**
 * Design tokens shared by web and mobile (§6: no magic numbers in UI code). Built for low-end
 * phones in bright sun: high contrast, large tap targets, a small palette.
 */
export const colors = {
  brand: '#1F7A4D', // VetLink green
  brandDark: '#155C39',
  brandLight: '#E6F4EC',
  emergency: '#C62828',
  emergencyLight: '#FDECEA',
  warning: '#B26A00',
  warningLight: '#FFF4E0',
  info: '#1565C0',
  infoLight: '#E8F1FB',
  ink: '#1A1F1C',
  muted: '#5C6660',
  line: '#D5DBD7',
  surface: '#FFFFFF',
  canvas: '#F5F7F6',
} as const;

/** Spacing scale in px (4-pt grid). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** Type scale in px: readable on small screens without zooming. */
export const fontSize = { sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;

/** Minimum touch target (px), per platform accessibility guidance. */
export const touchTarget = 48;

/** All tokens as CSS custom properties (`--vl-color-brand`, `--vl-space-md`, …). */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) out[`--vl-color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(space)) out[`--vl-space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(radius)) out[`--vl-radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(fontSize)) out[`--vl-font-${k}`] = `${v}px`;
  out['--vl-touch'] = `${touchTarget}px`;
  return out;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
export * from './illustrations.js';
