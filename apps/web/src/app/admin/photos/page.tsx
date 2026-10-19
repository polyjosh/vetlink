'use client';

import { useCallback, useState } from 'react';
import { PHOTO_REJECT_REASONS, type PhotoRejectReason } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { PersonAvatar } from '@/components/pictures';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, Field, Select, Spinner } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** Vets' new profile photos (§24.1): compare with the current photo and the ID, then decide. */
export default function PhotoQueue() {
  const { t, lang } = useT();
  const { api } = useSession();
  const a = t.web.admin;
  const [rows, setRows] = useState<Schemas['PhotoReviewItem'][] | null>(null);
  const [reasons, setReasons] = useState<Record<string, PhotoRejectReason>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/vet-photos');
    setRows(data ?? []);
  }, [api]);
  usePoll(load, 30_000);

  async function viewId(docId: number) {
    const { data, error: e } = await api.GET('/v1/admin/vet-documents/{id}/url', {
      params: { path: { id: docId } },
    });
    if (e || !data) return setError(errorText(lang, e));
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  async function decide(mediaId: string, body: Parameters<typeof send>[1]) {
    setError(null);
    const { error: e } = await send(mediaId, body);
    if (e) setError(errorText(lang, e));
    await load();
  }
  const send = (
    mediaId: string,
    body: { decision: 'approve' } | { decision: 'reject'; reason: PhotoRejectReason },
  ) => api.POST('/v1/admin/vet-photos/{mediaId}/decision', { params: { path: { mediaId } }, body });

  return (
    <Shell title={a.photoQueue} role="admin" nav={<AdminNav />}>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner label={t.web.common.loading} />
      ) : (
        <div className="space-y-4">
          {rows.length === 0 && (
            <Card>
              <p className="text-muted">{a.photoQueueEmpty}</p>
            </Card>
          )}
          {rows.map((r) => (
            <Card key={r.mediaId} className="space-y-3">
              <p className="font-bold">
                {r.name ?? '-'} ·{' '}
                {r.type === 'vet' ? t.web.onboarding.vetTypeVet : t.web.onboarding.vetTypeParavet}
              </p>
              <div className="flex flex-wrap gap-6">
                <figure className="text-center">
                  {r.currentUrl ? (
                    <PersonAvatar url={r.currentUrl} name={r.name} size={128} />
                  ) : (
                    <p className="text-muted">{a.noCurrentPhoto}</p>
                  )}
                  <figcaption className="text-sm text-muted">{a.currentPhoto}</figcaption>
                </figure>
                <figure className="text-center">
                  <PersonAvatar url={r.pendingUrl} name={r.name} size={128} />
                  <figcaption className="text-sm text-muted">{a.newPhoto}</figcaption>
                </figure>
              </div>
              {r.idFrontDocumentId !== null && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (r.idFrontDocumentId !== null) void viewId(r.idFrontDocumentId);
                  }}
                >
                  {a.openIdPhoto}
                </Button>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Button onClick={() => void decide(r.mediaId, { decision: 'approve' })}>
                  {a.approvePhoto}
                </Button>
                <Field label={a.rejectReason}>
                  <Select
                    value={reasons[r.mediaId] ?? ''}
                    onChange={(e) =>
                      setReasons({ ...reasons, [r.mediaId]: e.target.value as PhotoRejectReason })
                    }
                  >
                    <option value="">{t.web.common.choose}</option>
                    {PHOTO_REJECT_REASONS.map((x) => (
                      <option key={x} value={x}>
                        {t.web.profile.photoReasons[x]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="danger"
                  disabled={!reasons[r.mediaId]}
                  onClick={() => {
                    const reason = reasons[r.mediaId];
                    if (reason) void decide(r.mediaId, { decision: 'reject', reason });
                  }}
                >
                  {a.rejectPhoto}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
