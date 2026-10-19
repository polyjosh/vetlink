'use client';

import { useState } from 'react';
import type { PhotoKind } from '@vetlink/shared';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { preparePhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

/**
 * Pick a photo, shrink it on the device, upload it straight to private storage, then hand the
 * storage key to `onUploaded` (which confirms it with the API).
 */
export function PhotoUpload({
  kind,
  label,
  onUploaded,
  disabled,
}: {
  kind: PhotoKind;
  label: string;
  onUploaded: (storageKey: string) => Promise<{ code: string } | null | undefined>;
  disabled?: boolean;
}) {
  const { t, lang } = useT();
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const blob = await preparePhoto(file, kind);
      const p = await api.POST('/v1/uploads/presign', {
        body: { purpose: 'photo', photoKind: kind, contentType: 'image/jpeg', size: blob.size },
      });
      if (p.error || !p.data) {
        setError(errorText(lang, p.error));
        return;
      }
      const put = await fetch(p.data.uploadUrl, {
        method: 'PUT',
        headers: p.data.headers,
        body: blob,
      });
      if (!put.ok) throw new Error('upload');
      const failed = await onUploaded(p.data.storageKey);
      if (failed) setError(errorText(lang, failed));
    } catch {
      setError(t.web.profile.photoFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label
        className={`inline-flex min-h-touch cursor-pointer items-center rounded-control border border-line bg-surface px-4 font-semibold ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        {busy ? t.web.profile.uploading : label}
        <input
          type="file"
          className="sr-only"
          accept="image/*"
          capture={kind === 'avatar' ? 'user' : 'environment'}
          disabled={disabled || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </label>
      {error && (
        <p role="alert" className="mt-1 text-sm text-emergency">
          {error}
        </p>
      )}
    </div>
  );
}
