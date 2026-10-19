import {
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_BYTES,
  PHOTO_SIZE_PX,
  type PhotoKind,
} from '@vetlink/shared';

/**
 * Shrink and re-encode a picked photo before upload (§24.1): avatars are cropped square, animal
 * photos keep their shape. Re-encoding through a canvas drops EXIF, including GPS (§17).
 */
export async function preparePhoto(file: File, kind: PhotoKind): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = PHOTO_SIZE_PX[kind];
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (kind === 'avatar') {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas unavailable');
  g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Step the quality down until it fits; very detailed photos need a little more squeezing.
  for (let q = PHOTO_JPEG_QUALITY; q >= 0.3; q -= 0.15) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
  }
  throw new Error('photo too large');
}
