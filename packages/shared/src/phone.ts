// Kenyan mobile numbers: 07xx / 01xx locally, 2547xx / 2541xx internationally.
const KENYAN_MOBILE = /^(?:\+?254|0)([17]\d{8})$/;

/**
 * Normalize a Kenyan mobile number to the stored account form `2547XXXXXXXX` / `2541XXXXXXXX`.
 * Accepts `07…`, `01…`, `2547…`, `+2547…`, with spaces or dashes. Returns null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  const match = KENYAN_MOBILE.exec(compact);
  return match ? `254${match[1]}` : null;
}

/** A phone number for display where the full number is not needed: `2547****123`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '****';
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}
