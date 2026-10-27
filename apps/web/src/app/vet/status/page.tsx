'use client';

import { useEffect, useState } from 'react';
import { applicationChecklist } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import type { Tone } from '@vetlink/ui-tokens';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ErrorBox,
  Icon,
  LinkButton,
  Notice,
  Spinner,
  toneClass,
} from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Application status (§8.3): reference, state, what to fix, or the approval orientation. */
export default function VetStatus() {
  const { t, fmt, lang } = useT();
  const { api, me, reloadMe } = useSession();
  const [app, setApp] = useState<Schemas['VetApplication'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.GET('/v1/vets/me/application').then(({ data }) => setApp(data ?? null));
  }, [api]);
  if (!app) return <Spinner label={t.web.common.loading} />;
  const a = t.web.application;
  const vetStatus = me?.vet?.verificationStatus;
  const items = applicationChecklist(app);
  const flagged = items.filter((i) => i.state === 'flagged').length;
  // Warning for "changes needed", info while in review, success once approved.
  const bannerTone: Tone =
    vetStatus === 'suspended' || app.status === 'rejected'
      ? 'danger'
      : app.status === 'changes_requested'
        ? 'warning'
        : app.status === 'approved'
          ? 'success'
          : app.status === 'draft' || app.status === 'withdrawn'
            ? 'neutral'
            : 'info';

  return (
    <Shell title={a.statusTitle} role="vet" nav={vetStatus === 'approved' ? <VetNav /> : undefined}>
      <div className="space-y-4">
        <section className={`space-y-1.5 rounded-lg p-4 sm:p-5 ${toneClass(bannerTone)}`}>
          <p className="text-title" data-testid="application-state">
            {vetStatus === 'suspended' ? a.suspendedTitle : a.states[app.status]}
          </p>
          {flagged > 0 && <p className="font-bold">{fmt(a.itemsToFix, { n: flagged })}</p>}
          <p className="text-small text-ink">{fmt(a.reference, { ref: app.reference })}</p>
          {(app.status === 'submitted' || app.status === 'under_review') && (
            <p className="text-small text-ink">
              {fmt(a.reviewTarget, { hours: app.reviewTargetHours })}
            </p>
          )}
          {app.status !== 'approved' && vetStatus !== 'suspended' && (
            <p className="text-small text-ink">{a.noRequestsUntil}</p>
          )}
        </section>

        {app.decision &&
          app.status !== 'approved' &&
          (app.decision.reasons.length > 0 || app.decision.note) && (
            <Card className="space-y-2">
              <h2 className="text-heading">
                {app.status === 'rejected' ? a.rejectedTitle : a.changesTitle}
              </h2>
              <ul className="list-disc space-y-1 pl-5">
                {app.decision.reasons.map((r) => (
                  <li key={r}>{t.application.reasons[r]}</li>
                ))}
              </ul>
              {app.decision.note && (
                <p>
                  <strong>{a.noteFromReviewer}: </strong>
                  {app.decision.note}
                </p>
              )}
            </Card>
          )}

        {app.status !== 'draft' && app.status !== 'withdrawn' && (
          <Card className="!p-0">
            <h2 className="px-4 pt-4 text-heading sm:px-5">{a.checklistTitle}</h2>
            <ul className="divide-y divide-divider">
              {items.map((it) => {
                const key = it.kind === 'step' ? it.step : `doc-${it.doc}`;
                const label = it.kind === 'step' ? a.steps[it.step] : a.docKinds[it.doc];
                const fix = it.state === 'flagged';
                return (
                  <li
                    key={key}
                    className={`flex gap-3 px-4 py-3.5 sm:px-5 ${fix ? 'bg-warning-soft' : ''}`}
                  >
                    <span
                      aria-hidden
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                        fix
                          ? 'bg-warning text-on-primary'
                          : it.state === 'accepted'
                            ? 'bg-success-soft text-success'
                            : 'bg-neutral-soft text-ink-muted'
                      }`}
                    >
                      <Icon
                        name={fix ? 'alert' : it.state === 'accepted' ? 'check' : 'clock'}
                        size={16}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">{label}</span>
                        <span
                          className={`text-small font-bold ${fix ? 'text-warning' : 'text-ink-muted'}`}
                        >
                          {fix
                            ? a.itemFlagged
                            : it.state === 'accepted'
                              ? a.itemAccepted
                              : a.itemInReview}
                        </span>
                      </div>
                      {fix && it.kind === 'doc' && it.note && (
                        <p className="mt-1 text-small">{it.note}</p>
                      )}
                      {fix && (
                        <LinkButton
                          href="/vet/application"
                          variant="secondary"
                          icon={it.kind === 'doc' ? 'camera' : undefined}
                          className="mt-2"
                        >
                          {a.fixItem}
                        </LinkButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <p className="flex items-center gap-2 text-small text-ink-muted">
          <Icon name="lock" size={18} />
          {a.privacyLine}
        </p>

        {vetStatus === 'suspended' && <Notice tone="warning">{a.contactSupport}</Notice>}
        {app.status === 'rejected' && <Notice>{a.contactSupport}</Notice>}

        {app.status === 'approved' && vetStatus === 'approved' && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{a.approvedTitle}</h2>
            <p>{a.orientation}</p>
            <LinkButton href="/vet">{a.continue}</LinkButton>
          </Card>
        )}

        {(app.status === 'draft' || app.status === 'withdrawn') && (
          <LinkButton href="/vet/application">{a.continue}</LinkButton>
        )}
        {app.status === 'changes_requested' && (
          <LinkButton href="/vet/application" size="lg" className="w-full">
            {a.fixAndResubmit}
          </LinkButton>
        )}
        {app.status === 'submitted' && (
          <Button
            variant="secondary"
            onClick={async () => {
              const { error: e } = await api.POST('/v1/vets/me/application/withdraw');
              if (e) return setError(errorText(lang, e));
              await reloadMe();
              window.location.assign('/vet/application');
            }}
          >
            {a.withdraw}
          </Button>
        )}
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
