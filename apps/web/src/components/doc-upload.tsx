'use client';

import { useState } from 'react';
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, type VetDocumentKind } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Badge } from './ui';

type Doc = Schemas['VetApplication']['documents'][number];

/** Presign → PUT straight to private storage → confirm (§8.3; the API never proxies the file). */
export function DocUpload({
  kind,
  doc,
  disabled,
  onDone,
}: {
  kind: VetDocumentKind;
  doc: Doc | undefined;
  disabled: boolean;
  onDone: (a: Schemas['VetApplication']) => void;
}) {
  const { t, lang } = useT();
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const type = file.type as (typeof DOCUMENT_CONTENT_TYPES)[number];
    if (!DOCUMENT_CONTENT_TYPES.includes(type) || file.size > DOCUMENT_MAX_BYTES) {
      setError(t.web.application.uploadFailed);
      return;
    }
    setBusy(true);
    try {
      const p = await api.POST('/v1/uploads/presign', {
        body: { purpose: 'vet_document', documentKind: kind, contentType: type, size: file.size },
      });
      if (p.error || !p.data) throw p.error;
      const put = await fetch(p.data.uploadUrl, {
        method: 'PUT',
        headers: p.data.headers,
        body: file,
      });
      if (!put.ok) throw new Error('upload');
      const c = await api.POST('/v1/vets/me/application/documents', {
        body: { kind, storageKey: p.data.storageKey },
      });
      if (c.error || !c.data) throw c.error;
      onDone(c.data);
    } catch (e) {
      setError(
        e && typeof e === 'object' && 'code' in e
          ? errorText(lang, e as { code: string })
          : t.web.application.uploadFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-control border border-line p-3">
      <span className="flex-1 font-semibold">{t.web.application.docKinds[kind]}</span>
      {doc?.status === 'flagged' ? (
        <Badge tone="danger">{t.web.application.flagged}</Badge>
      ) : (
        doc && <Badge tone="success">{t.web.application.uploaded}</Badge>
      )}
      <label
        className={`inline-flex min-h-touch cursor-pointer items-center rounded-control border border-line px-3 font-semibold ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        {busy
          ? t.web.application.uploading
          : doc
            ? t.web.application.replace
            : t.web.application.upload}
        <input
          type="file"
          className="sr-only"
          accept={DOCUMENT_CONTENT_TYPES.join(',')}
          capture={kind === 'profile_photo' ? 'user' : 'environment'}
          disabled={disabled || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </label>
      {doc?.flagReason && <p className="w-full text-sm text-emergency">{doc.flagReason}</p>}
      {error && (
        <p role="alert" className="w-full text-sm text-emergency">
          {error}
        </p>
      )}
    </div>
  );
}
