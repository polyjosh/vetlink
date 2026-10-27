/**
 * Design tokens shared by web and mobile (§6: no magic numbers in UI code). Built for low-end
 * phones in bright sun: high contrast, large tap targets, a small palette. The v1 design system
 * lives in `tokens.ts`; the names below are the pre-v1 names kept as aliases so older code keeps
 * working with the new values.
 */
import { color, layout, radius, shadow, size, type } from './tokens.js';

export * from './tokens.js';

/** Pre-v1 colour names, now aliases of `color`. */
export const colors = {
  brand: color.primary,
  brandDark: color.primaryPressed,
  brandLight: color.primarySoft,
  emergency: color.danger,
  emergencyLight: color.dangerSoft,
  warning: color.warning,
  warningLight: color.warningSoft,
  info: color.info,
  infoLight: color.infoSoft,
  ink: color.ink,
  muted: color.inkMuted,
  line: color.border,
  surface: color.surface,
  canvas: color.ground,
} as const;

/** Spacing in px on a 4 px grid: `space[4]` = 16. The named keys are the pre-v1 aliases. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Pre-v1 type scale in px, kept for older screens; new code uses `type`. */
export const fontSize = { sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;

/** Minimum touch target (px), per platform accessibility guidance. */
export const touchTarget = size.touchMin;

/** All tokens as CSS custom properties (`--vl-color-primary`, `--vl-space-4`, …). */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(color)) out[`--vl-color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(colors)) out[`--vl-color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(space)) out[`--vl-space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(radius)) out[`--vl-radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(fontSize)) out[`--vl-font-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(type)) {
    out[`--vl-text-${k}`] = `${v.size}px`;
    out[`--vl-text-${k}-line`] = `${v.line}px`;
    out[`--vl-text-${k}-weight`] = v.weight;
  }
  for (const [k, v] of Object.entries(size)) out[`--vl-size-${kebab(k)}`] = `${v}px`;
  for (const [k, v] of Object.entries(shadow)) out[`--vl-shadow-${k}`] = v;
  out['--vl-size-content'] = `${layout.webMaxWidth}px`;
  out['--vl-touch'] = `${touchTarget}px`;
  return out;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
export * from './illustrations.js';
export * from './icons.js';
