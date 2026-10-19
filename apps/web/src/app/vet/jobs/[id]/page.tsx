'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { Shell } from '@/components/shell';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Notice,
  Spinner,
  TextArea,
} from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { PersonAvatar } from '@/components/pictures';

/** Directions open in the phone's own maps app (no map SDK yet: owner decision). */
function directionsUrl(job: Schemas['VetJob']): string {
  const dest = job.location
    ? `${job.location.lat},${job.location.lng}`
    : `${job.ward.ward}, ${job.ward.county}, Kenya`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/** The job (§8.3): farmer contact, directions, status buttons, completion notes. */
export default function Job() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const router = useRouter();
  const [job, setJob] = useState<Schemas['VetJob'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [drugs, setDrugs] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await api.GET('/v1/bookings/{id}', {
      params: { path: { id: Number(id) } },
    });
    if (e) setError(errorText(lang, e));
    else setJob(data as Schemas['VetJob']);
  }, [api, id, lang]);
  usePoll(load, 10_000);

  if (!job)
    return (
      <Shell title={fmt(t.web.tracking.title, { ref: id })} role="vet" nav={<VetNav />}>
        {error ? <ErrorBox message={error} /> : <Spinner label={t.web.common.loading} />}
      </Shell>
    );

  const act = async (fn: () => Promise<{ error?: unknown }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(errorText(lang, e as { code: string; message_key: string }));
    else after?.();
    await load();
  };
  const path = { params: { path: { id: job.id } } };

  return (
    <Shell title={fmt(t.web.tracking.title, { ref: job.id })} role="vet" nav={<VetNav />}>
      <div className="space-y-4">
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            {job.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
            <p className="text-xl font-bold" data-testid="job-status">
              {t.ussd.statuses[job.status]}
            </p>
          </div>
          <p>
            {t.ussd.species[job.species]}, {t.ussd.problems[job.problemType]}
          </p>
          {job.note && <p className="italic">“{job.note}”</p>}
          <p>{fmt(t.web.common.kes, { amount: job.feeQuoted })}</p>
        </Card>
        <Card className="space-y-2">
          <div className="flex items-center gap-3">
            <PersonAvatar
              url={job.farmer.photoUrl}
              name={job.farmer.displayName ?? job.farmer.name}
              size={48}
            />
            <p>
              <strong>{t.web.vet.farmer}: </strong>
              {job.farmer.displayName ?? job.farmer.name ?? '-'}
            </p>
          </div>
          <p>
            {job.ward.ward}, {job.ward.subCounty}
          </p>
          {job.farmer.farmNotes && (
            <p>
              <strong>{t.web.vet.landmarks}: </strong>
              {job.farmer.farmNotes}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {job.farmer.phone && (
              <a
                href={`tel:+${job.farmer.phone}`}
                className="inline-flex min-h-touch items-center rounded-control bg-brand px-4 font-semibold text-white"
              >
                {t.web.common.call}
              </a>
            )}
            <a
              href={directionsUrl(job)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-touch items-center rounded-control border border-line px-4 font-semibold"
            >
              {t.web.vet.navigate}
            </a>
          </div>
        </Card>
        <ErrorBox message={error} />
        <div className="flex flex-wrap gap-2">
          {job.actions.includes('vet_en_route') && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.POST('/v1/bookings/{id}/status', { ...path, body: { status: 'en_route' } }),
                )
              }
            >
              {t.web.vet.onMyWay}
            </Button>
          )}
          {job.actions.includes('vet_arrived') && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.POST('/v1/bookings/{id}/status', { ...path, body: { status: 'in_service' } }),
                )
              }
            >
              {t.web.vet.arrived}
            </Button>
          )}
          {job.actions.includes('vet_released') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api.POST('/v1/bookings/{id}/release', path),
                  () => router.replace('/vet'),
                )
              }
            >
              {t.web.vet.release}
            </Button>
          )}
        </div>
        {job.actions.includes('vet_completed') && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{t.web.vet.completeTitle}</h2>
            <Field label={t.web.vet.diagnosis}>
              <Input
                name="diagnosis"
                value={diagnosis}
                maxLength={200}
                onChange={(e) => setDiagnosis(e.target.value)}
              />
            </Field>
            <Field label={t.web.vet.drugs}>
              <Input value={drugs} maxLength={500} onChange={(e) => setDrugs(e.target.value)} />
            </Field>
            <Field label={t.web.vet.notes}>
              <TextArea
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Field label={`${t.web.vet.followUp} (${t.web.common.optional})`}>
              <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </Field>
            <Button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.POST('/v1/bookings/{id}/complete', {
                    ...path,
                    body: {
                      ...(diagnosis && { diagnosis }),
                      ...(drugs && { drugsUsed: drugs }),
                      ...(notes && { notes }),
                      ...(followUp && { followUpDate: followUp }),
                    },
                  }),
                )
              }
            >
              {t.web.vet.complete}
            </Button>
          </Card>
        )}
        {job.status === 'done' && <Notice tone="success">{t.web.vet.completed}</Notice>}
      </div>
    </Shell>
  );
}
