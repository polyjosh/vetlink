import { messages, type Locale } from '@vetlink/i18n';

/** Turn an API error (`{ code, message_key }`) into text in the user's language. */
export function errorText(
  lang: Locale,
  error: { code?: string; message_key?: string } | null | undefined,
): string {
  if (!error) return '';
  const key = (error.message_key ?? '').replace(/^errors\./, '');
  const table = messages[lang].errors as Record<string, string>;
  return table[key] ?? table[error.code ?? ''] ?? messages[lang].web.common.somethingWrong;
}
