import { router } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../../src/components/screen';
import { Button, Card, ErrorText, H2, Loading, Notice, P } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

/** Application status (§8.3): reference, state, what to fix, or the approval orientation. */
export default function VetStatus() {
  const { t, fmt, err } = useT();
  const { me, reloadMe } = useSession();
  const q = useApi(['application'], () => api.GET('/v1/vets/me/application'), {
    cache: 'vet:application',
    refetchInterval: 30_000,
  });
  const [error, setError] = useState<string | null>(null);
  const app = q.data;
  const a = t.web.application;
  const vetStatus = me?.vet?.verificationStatus;
  if (!app)
    return (
      <Screen title={a.statusTitle} role="vet">
        <Loading label={t.web.common.loading} />
      </Screen>
    );
  return (
    <Screen
      title={a.statusTitle}
      role="vet"
      onRefresh={() => void Promise.all([q.refetch(), reloadMe()])}
      refreshing={q.isRefetching}
    >
      <Card>
        <H2>{vetStatus === 'suspended' ? a.suspendedTitle : a.states[app.status]}</H2>
        <P>{fmt(a.reference, { ref: app.reference })}</P>
        {(app.status === 'submitted' || app.status === 'under_review') && (
          <>
            <P>{fmt(a.reviewTarget, { hours: app.reviewTargetHours })}</P>
            <Notice tone="warning">{a.cannotWork}</Notice>
          </>
        )}
      </Card>
      {app.decision && app.status !== 'approved' && (
        <Card>
          <H2>{app.status === 'rejected' ? a.rejectedTitle : a.changesTitle}</H2>
          {app.decision.reasons.map((r) => (
            <P key={r}>{`• ${t.application.reasons[r]}`}</P>
          ))}
          {app.decision.note && <P>{`${a.noteFromReviewer}: ${app.decision.note}`}</P>}
        </Card>
      )}
      {(vetStatus === 'suspended' || app.status === 'rejected') && (
        <Notice>{a.contactSupport}</Notice>
      )}
      {app.status === 'approved' && vetStatus === 'approved' && (
        <Card>
          <H2>{a.approvedTitle}</H2>
          <P>{a.orientation}</P>
          <Button title={a.continue} onPress={() => router.replace('/vet')} />
        </Card>
      )}
      {(app.status === 'draft' || app.status === 'withdrawn') && (
        <Button title={a.continue} onPress={() => router.push('/vet/application')} />
      )}
      {app.status === 'changes_requested' && (
        <Button title={a.resubmit} onPress={() => router.push('/vet/application')} />
      )}
      {app.status === 'submitted' && (
        <Button
          variant="secondary"
          title={a.withdraw}
          onPress={async () => {
            try {
              const { error: e } = await api.POST('/v1/vets/me/application/withdraw');
              if (e) return setError(err(e));
              await reloadMe();
              router.replace('/vet/application');
            } catch {
              setError(t.web.common.offline);
            }
          }}
        />
      )}
      <ErrorText message={error} />
    </Screen>
  );
}
