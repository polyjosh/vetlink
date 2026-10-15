/** Supported languages. Every key must exist in both. */
export const LOCALES = ['sw', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'sw';
