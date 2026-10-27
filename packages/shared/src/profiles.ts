/** Profiles and photos (§24.1, §24.2). Shared so clients validate exactly like the server. */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/**
 * A username is a display name only, never a login (invariant 1). Letters in any script,
 * digits, spaces and `. _ -`; it must not look like a phone number or a link.
 */
export function usernameProblem(value: string): 'length' | 'characters' | 'contact' | null {
  const v = value.trim();
  if (v.length < USERNAME_MIN || v.length > USERNAME_MAX) return 'length';
  if (!/^[\p{L}\p{M}\p{N} ._-]+$/u.test(v)) return 'characters';
  if ((v.match(/\p{N}/gu) ?? []).length >= 7) return 'contact';
  if (/www\.|\.(com|co|ke|org|net)\b/i.test(v)) return 'contact';
  return null;
}

/** Photos are re-encoded on the device (drops EXIF) and must fit this (§24.1). */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];
export const PHOTO_MAX_BYTES = 500 * 1024;

/** Longest edge after on-device resizing, in pixels. */
export const PHOTO_SIZE_PX = { avatar: 512, animal_photo: 1024, booking_photo: 1024 } as const;
export const PHOTO_JPEG_QUALITY = 0.7;

/** Photos a user can upload through `POST /v1/uploads/presign` with `purpose: media`. */
export const PHOTO_KINDS = ['avatar', 'animal_photo', 'booking_photo'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Photos a farmer can attach to one request (§8.2 step 3, §24.15). */
export const BOOKING_PHOTOS_MAX = 3;

/** Why a verifier turned down a vet's new photo (localized under `profile.photoReasons`). */
export const PHOTO_REJECT_REASONS = [
  'face_not_clear',
  'not_same_person',
  'inappropriate',
  'other',
] as const;
export type PhotoRejectReason = (typeof PHOTO_REJECT_REASONS)[number];
