'use client';

import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  APPLICATION_REASONS,
  APPLICATION_STEPS,
  maskPhone,
  type ApplicationDecision,
  type ApplicationReason,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { ApplicationQueue } from '@/components/admin-queue';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Icon,
  Notice,
  Spinner,
  TextArea,
} from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v ?? '');

/** Review an application (§13): details, decrypted ID, documents, duplicates, decision. */
export default function Review() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
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
      <Shell title={a.queue} subtitle={a.queueSubtitle} role="admin" nav={<AdminNav />}>
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
  const name = r.applicant.name ?? '-';
  const chip = (x: ApplicationReason) => (
    <label
      key={x}
      className={`flex min-h-touch cursor-pointer items-center gap-2 rounded-full border-strong px-3 text-small font-semibold ${reasons.includes(x) ? 'border-primary bg-primary-soft' : 'border-border bg-surface'}`}
    >
      <input
        type="checkbox"
        className="accent-primary"
        checked={reasons.includes(x)}
        onChange={() => setReasons(toggle(reasons, x))}
      />
      {t.application.reasons[x]}
    </label>
  );
  return (
    <Shell title={a.queue} subtitle={a.queueSubtitle} role="admin" nav={<AdminNav />}>
      {dialog}
      <div className="flex flex-wrap items-start gap-5">
        <div className="hidden min-w-0 flex-[1_1_340px] wrap:block">
          <ApplicationQueue selected={Number(id)} />
        </div>
        <div className="min-w-0 flex-[2_1_480px] space-y-4">
          <Card className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-title">{name}</h2>
                <p className="mt-0.5 text-small text-ink-muted">
                  {[
                    r.reference,
                    r.applicant.phone ? maskPhone(r.applicant.phone) : null,
                    r.submittedAt
                      ? fmt(a.submittedOn, {
                          date: new Date(r.submittedAt).toLocaleString(lang, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="flex flex-wrap gap-2">
                {r.createdVia === 'admin_assisted' && <Badge>{a.assisted}</Badge>}
                <Badge tone={reviewable ? 'warning' : r.status === 'approved' ? 'success' : 'info'}>
                  {t.web.application.states[r.status]}
                </Badge>
              </span>
            </div>
            <p className="rounded-md bg-ground p-3">
              <span className="text-small text-ink-muted">{a.nationalId}</span>
              <span className="block font-bold">{r.nationalId ?? '-'}</span>
            </p>
            <div className="space-y-2">
              <h3 className="font-bold">{a.duplicates}</h3>
              {r.duplicates.length === 0 ? (
                <p className="text-small text-ink-muted">{a.noDuplicates}</p>
              ) : (
                r.duplicates.map((d) => (
                  <Notice key={d.userId} tone="warning">
                    {d.userId} · {d.status} · {d.matches.join(', ')}
                  </Notice>
                ))
              )}
            </div>

            {APPLICATION_STEPS.map((step) => (
              <section key={step} className="space-y-1 border-t border-divider pt-4">
                <h3 className="font-bold">{t.web.application.steps[step]}</h3>
                <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {Object.entries(r.steps[step] ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-2 py-1.5">
                      {reviewable && (
                        <input
                          type="checkbox"
                          className="mt-1 accent-warning"
                          aria-label={`${a.flagItems}: ${label(k)}`}
                          checked={flags.includes(`${step}.${k}`)}
                          onChange={() => setFlags(toggle(flags, `${step}.${k}`))}
                        />
                      )}
                      <div className="min-w-0">
                        <dt className="text-small text-ink-muted">{label(k)}</dt>
                        <dd className="font-semibold break-words">{show(v)}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </section>
            ))}

            <section className="space-y-3 border-t border-divider pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold">{t.web.application.documents}</h3>
                <span className="flex items-center gap-1.5 text-small text-ink-muted">
                  <Icon name="lock" size={16} />
                  {a.docsAudited}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.documents.map((d) => (
                  <li
                    key={d.id}
                    className={`flex flex-col gap-2 rounded-md border p-3 ${d.status === 'flagged' || flags.includes(`doc.${d.kind}`) ? 'border-warning bg-warning-soft' : 'border-border'}`}
                  >
                    <button
                      type="button"
                      onClick={() => void viewDoc(d.id)}
                      className="flex min-h-touch items-center gap-2 text-left font-bold text-primary"
                    >
                      <Icon name="file" />
                      <span className="min-w-0 flex-1">
                        {t.web.application.docKinds[d.kind]}
                        <span className="block text-small font-semibold text-ink-muted">
                          {a.viewDocument}
                        </span>
                      </span>
                    </button>
                    {d.status === 'flagged' && (
                      <Badge tone="danger">{t.web.application.flagged}</Badge>
                    )}
                    {reviewable && (
                      <label className="flex min-h-touch items-center gap-2 text-small">
                        <input
                          type="checkbox"
                          className="accent-warning"
                          checked={flags.includes(`doc.${d.kind}`)}
                          onChange={() => setFlags(toggle(flags, `doc.${d.kind}`))}
                        />
                        {a.flagItems}
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </Card>

          {r.status === 'submitted' && (
            <Button
              variant="secondary"
              className="w-full"
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
            <Card raised className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 font-bold">{a.reasons}</legend>
                <div className="flex flex-wrap gap-2">{APPLICATION_REASONS.map(chip)}</div>
              </fieldset>
              <Field label={a.noteToVet} hint={a.noteHint}>
                <TextArea
                  rows={3}
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
                <p className="text-small">
                  <strong>{a.flagItems}: </strong>
                  {flags.join(', ')}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button size="lg" icon="check" onClick={() => void decide('approve')}>
                  {a.approve}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={reasons.length === 0 || flags.length === 0}
                  onClick={() => void decide('request_changes')}
                >
                  {a.requestChanges}
                </Button>
                <Button
                  size="lg"
                  variant="danger"
                  className="ml-auto"
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
      </div>
    </Shell>
  );
}
