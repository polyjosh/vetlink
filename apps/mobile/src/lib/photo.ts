import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_BYTES,
  PHOTO_SIZE_PX,
  type PhotoKind,
} from '@vetlink/shared';
import { api } from './session';

export type PhotoSource = 'camera' | 'library';

/**
 * Pick a photo and shrink it on the phone (§24.1): avatars are cropped square in the picker.
 * Re-encoding to JPEG drops EXIF, including GPS (§17). Returns null if cancelled.
 */
export async function pickPhoto(
  source: PhotoSource,
  kind: PhotoKind,
): Promise<{ uri: string; size: number } | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: kind === 'avatar',
    ...(kind === 'avatar' && { aspect: [1, 1] as [number, number] }),
    cameraType: kind === 'avatar' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    exif: false,
  };
  const res =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const max = PHOTO_SIZE_PX[kind];
  const landscape = (asset.width || max) >= (asset.height || max);
  const ref = await ImageManipulator.manipulate(asset.uri)
    .resize(
      landscape
        ? { width: Math.min(asset.width || max, max) }
        : { height: Math.min(asset.height || max, max) },
    )
    .renderAsync();
  for (let q = PHOTO_JPEG_QUALITY; q >= 0.3; q -= 0.15) {
    const out = await ref.saveAsync({ compress: q, format: SaveFormat.JPEG });
    const size = (await (await fetch(out.uri)).blob()).size;
    if (size <= PHOTO_MAX_BYTES) return { uri: out.uri, size };
  }
  throw new Error('too large');
}

/** Upload straight to private storage; returns the key to confirm with the API. */
export async function uploadPhoto(
  kind: PhotoKind,
  photo: { uri: string; size: number },
): Promise<{ storageKey: string } | { error: { code: string } }> {
  const p = await api.POST('/v1/uploads/presign', {
    body: { purpose: 'photo', photoKind: kind, contentType: 'image/jpeg', size: photo.size },
  });
  if (p.error || !p.data) return { error: p.error ?? { code: 'internal_error' } };
  const put = await fetch(p.data.uploadUrl, {
    method: 'PUT',
    headers: p.data.headers,
    body: await (await fetch(photo.uri)).blob(),
  });
  if (!put.ok) return { error: { code: 'photo_invalid' } };
  return { storageKey: p.data.storageKey };
}
