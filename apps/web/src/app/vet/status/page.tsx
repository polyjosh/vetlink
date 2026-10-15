'use client';

import { useEffect, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { Shell } from '@/components/shell';
import { Button, Card, ErrorBox, LinkButton, Notice, Spinner } from '@/components/ui';
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

  return (
    <Shell title={a.statusTitle} role="vet" nav={vetStatus === 'approved' ? <VetNav /> : undefined}>
      <div className="space-y-4">
        <Card className="space-y-2">
          <p className="text-xl font-bold" data-testid="application-state">
            {vetStatus === 'suspended' ? a.suspendedTitle : a.states[app.status]}
          </p>
          <p>{fmt(a.reference, { ref: app.reference })}</p>
          {(app.status === 'submitted' || app.status === 'under_review') && (
            <>
              <p>{fmt(a.reviewTarget, { hours: app.reviewTargetHours })}</p>
              <Notice tone="warning">{a.cannotWork}</Notice>
            </>
          )}
        </Card>

        {app.decision && app.status !== 'approved' && (
          <Card className="space-y-2">
            <h2 className="font-bold">
              {app.status === 'rejected' ? a.rejectedTitle : a.changesTitle}
            </h2>
            <ul className="list-disc pl-5">
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
          <LinkButton href="/vet/application">{a.resubmit}</LinkButton>
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
