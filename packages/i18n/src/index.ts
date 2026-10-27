import en from './locales/en.json' with { type: 'json' };
import sw from './locales/sw.json' with { type: 'json' };
import type { Locale } from './locales.js';

export * from './locales.js';

/** `en` is the reference shape; assigning `sw` to it fails typecheck when a key is missing. */
export type Messages = typeof en;

export const messages: Record<Locale, Messages> = { en, sw };

/** Fill `{name}` placeholders. Unknown placeholders are left as-is so a missing value is visible. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** An API error (`{ code, message_key }`) as text in the user's language. */
export function errorMessage(
  locale: Locale,
  error: { code?: string; message_key?: string } | null | undefined,
): string {
  if (!error) return '';
  const table = messages[locale].errors as Record<string, string>;
  const key = (error.message_key ?? '').replace(/^errors\./, '');
  return table[key] ?? table[error.code ?? ''] ?? messages[locale].web.common.somethingWrong;
}
