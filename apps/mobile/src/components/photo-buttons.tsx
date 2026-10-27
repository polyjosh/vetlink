import { useState } from 'react';
import { View } from 'react-native';
import type { PhotoKind } from '@vetlink/shared';
import { useT } from '../lib/i18n';
import { pickPhoto, uploadPhoto, type PhotoSource } from '../lib/photo';
import { Button, ErrorText, s } from './ui';

/**
 * Take or choose a photo, shrink it, upload it, then hand the storage key to `onUploaded`
 * (which confirms it with the API and returns an API error, if any).
 */
export function PhotoButtons({
  kind,
  onUploaded,
}: {
  kind: PhotoKind;
  onUploaded: (storageKey: string) => Promise<{ code: string } | null | undefined>;
}) {
  const { t, err } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(source: PhotoSource) {
    setError(null);
    setBusy(true);
    try {
      const photo = await pickPhoto(source, kind);
      if (!photo) return;
      const up = await uploadPhoto(kind, photo);
      if ('error' in up) return setError(err(up.error));
      const failed = await onUploaded(up.storageKey);
      if (failed) setError(err(failed));
    } catch {
      setError(t.web.profile.photoFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View style={s.row}>
        <Button
          title={busy ? t.web.profile.uploading : t.web.mobile.takePhoto}
          disabled={busy}
          onPress={() => void go('camera')}
        />
        <Button
          title={t.web.mobile.choosePhoto}
          variant="secondary"
          disabled={busy}
          onPress={() => void go('library')}
        />
      </View>
      <ErrorText message={error} />
    </View>
  );
}
