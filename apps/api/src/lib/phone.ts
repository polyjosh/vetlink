/** Mask a phone number for logs: `254712345123` -> `2547****123`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '****';
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

// Kenyan numbers in international (+254 / 254) or local (07xx / 01xx) form.
const PHONE_PATTERN = /(?:\+?254|0)[17]\d{8}\b/g;

/** Replace every phone number found in free text with its masked form. */
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_PATTERN, (match) => maskPhone(match));
}
