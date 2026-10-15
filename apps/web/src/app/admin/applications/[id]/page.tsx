'use client';

import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  APPLICATION_REASONS,
  APPLICATION_STEPS,
  type ApplicationDecision,
  type ApplicationReason,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import { Badge, Button, Card, ErrorBox, Field, Notice, Spinner, TextArea } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v ?? '');

/** Review an application (§13): details, decrypted ID, documents, duplicates, decision. */
export default function Review() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useT();
  const { api } = useSession();
  const { run, dialog } = useStepUp();
  const [r, setR] = useState<Schemas['ApplicationReview'] | null>(null);
  const [reasons, setReasons] = useState<ApplicationReason[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const a = t.web.admin;
  const path = { params: { path: { id: Number(id) } } };

  const load = useCallback(async () => {
    const { data, error: e } = await api.GET('/v1/admin/vet-applications/{id}', path);
    if (e) setError(errorText(lang, e));
    setR(data ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, lang]);
  useLoad(load);

  if (!r)
    return (
      <Shell title={a.queue} role="admin" nav={<AdminNav />}>
        {error ? <ErrorBox message={error} /> : <Spinner label={t.web.common.loading} />}
      </Shell>
    );

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const label = (f: string) => (t.web.application.fields as Record<string, string>)[f] ?? f;

  async function decide(decision: ApplicationDecision) {
    setError(null);
    const { error: e } = await api.POST('/v1/admin/vet-applications/{id}/decision', {
      ...path,
      body: {
        decision,
        reasons,
        ...(note && { note }),
        ...(internal && { internalNote: internal }),
        ...(decision === 'request_changes' && { flaggedFields: flags }),
      },
    });
    if (e) return setError(errorText(lang, e));
    setDone(true);
    await load();
  }

  async function viewDoc(docId: number) {
    const { data, error: e } = await api.GET('/v1/admin/vet-documents/{id}/url', {
      params: { path: { id: docId } },
    });
    if (e || !data) return setError(errorText(lang, e));
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  const reviewable = r.status === 'submitted' || r.status === 'under_review';
  return (
    <Shell
      title={`${r.reference} · ${t.web.application.states[r.status]}`}
      role="admin"
      nav={<AdminNav />}
    >
      {dialog}
      <div className="space-y-4">
        <Card className="space-y-1">
          <h2 className="font-bold">{a.applicant}</h2>
          <p>
            {r.applicant.name ?? '-'} · {r.applicant.phone ?? '-'}
          </p>
          <p>
            <strong>{a.nationalId}: </strong>
            {r.nationalId ?? '-'}
          </p>
          {r.createdVia === 'admin_assisted' && <Badge>{a.assisted}</Badge>}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-bold">{a.duplicates}</h2>
          {r.duplicates.length === 0 ? (
            <p className="text-muted">{a.noDuplicates}</p>
          ) : (
            r.duplicates.map((d) => (
              <Notice key={d.userId} tone="warning">
                {d.userId} · {d.status} · {d.matches.join(', ')}
              </Notice>
            ))
          )}
        </Card>

        {APPLICATION_STEPS.map((step) => (
          <Card key={step} className="space-y-1">
            <h2 className="font-bold">{t.web.application.steps[step]}</h2>
            <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {Object.entries(r.steps[step] ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 py-1">
                  {reviewable && (
                    <input
                      type="checkbox"
                      aria-label={`${a.flagItems}: ${label(k)}`}
                      checked={flags.includes(`${step}.${k}`)}
                      onChange={() => setFlags(toggle(flags, `${step}.${k}`))}
                    />
                  )}
                  <dt className="font-semibold">{label(k)}:</dt>
                  <dd className="break-all">{show(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}

        <Card className="space-y-2">
          <h2 className="font-bold">{t.web.application.documents}</h2>
          {r.documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2">
              {reviewable && (
                <input
                  type="checkbox"
                  aria-label={`${a.flagItems}: ${t.web.application.docKinds[d.kind]}`}
                  checked={flags.includes(`doc.${d.kind}`)}
                  onChange={() => setFlags(toggle(flags, `doc.${d.kind}`))}
                />
              )}
              <span className="flex-1">{t.web.application.docKinds[d.kind]}</span>
              {d.status === 'flagged' && <Badge tone="danger">{t.web.application.flagged}</Badge>}
              <Button variant="secondary" onClick={() => void viewDoc(d.id)}>
                {a.viewDocument}
              </Button>
            </div>
          ))}
        </Card>

        {r.status === 'submitted' && (
          <Button
            onClick={async () => {
              const { error: e } = await api.POST('/v1/admin/vet-applications/{id}/claim', {
                ...path,
                body: { force: false },
              });
              if (e) setError(errorText(lang, e));
              await load();
            }}
          >
            {a.claim}
          </Button>
        )}

        {reviewable && (
          <Card className="space-y-3">
            <fieldset>
              <legend className="font-bold">{a.reasons}</legend>
              <div className="flex flex-wrap gap-2">
                {APPLICATION_REASONS.map((x) => (
                  <label
                    key={x}
                    className={`flex min-h-touch items-center gap-2 rounded-full border px-3 ${reasons.includes(x) ? 'border-brand bg-brand-light' : 'border-line'}`}
                  >
                    <input
                      type="checkbox"
                      checked={reasons.includes(x)}
                      onChange={() => setReasons(toggle(reasons, x))}
                    />
                    {t.application.reasons[x]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={a.noteToVet}>
              <TextArea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Field label={a.internalNote}>
              <TextArea
                rows={2}
                maxLength={1000}
                value={internal}
                onChange={(e) => setInternal(e.target.value)}
              />
            </Field>
            {flags.length > 0 && (
              <p className="text-sm">
                <strong>{a.flagItems}: </strong>
                {flags.join(', ')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void decide('approve')}>{a.approve}</Button>
              <Button
                variant="secondary"
                disabled={reasons.length === 0 || flags.length === 0}
                onClick={() => void decide('request_changes')}
              >
                {a.requestChanges}
              </Button>
              <Button
                variant="danger"
                disabled={reasons.length === 0}
                onClick={() => void decide('reject')}
              >
                {a.reject}
              </Button>
            </div>
          </Card>
        )}

        {r.status === 'approved' && (
          <Card className="space-y-2">
            <Button
              variant="danger"
              disabled={reasons.length === 0}
              onClick={async () =>
                setError(
                  await run(() =>
                    api.POST('/v1/admin/vets/{userId}/suspend', {
                      params: { path: { userId: r.vetUserId } },
                      body: { reasons, ...(note && { note }) },
                    }),
                  ),
                )
              }
            >
              {a.suspend}
            </Button>
            <Button
              variant="secondary"
              disabled={note.trim().length < 3}
              onClick={async () =>
                setError(
                  await run(() =>
                    api.POST('/v1/admin/vets/{userId}/reinstate', {
                      params: { path: { userId: r.vetUserId } },
                      body: { note },
                    }),
                  ),
                )
              }
            >
              {a.reinstate}
            </Button>
            <Field label={a.noteToVet}>
              <TextArea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <fieldset className="flex flex-wrap gap-2">
              {APPLICATION_REASONS.map((x) => (
                <label key={x} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={reasons.includes(x)}
                    onChange={() => setReasons(toggle(reasons, x))}
                  />
                  {t.application.reasons[x]}
                </label>
              ))}
            </fieldset>
          </Card>
        )}
        {done && <Notice tone="success">{a.decisionSaved}</Notice>}
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
