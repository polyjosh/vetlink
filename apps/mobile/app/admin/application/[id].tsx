import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';
import {
  APPLICATION_REASONS,
  APPLICATION_STEPS,
  type ApplicationDecision,
  type ApplicationReason,
} from '@vetlink/shared';
import { Screen } from '../../../src/components/screen';
import {
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Loading,
  Notice,
  P,
} from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v ?? '');

/** Review and decide (§13). Request-changes flags the whole documents set on mobile; finer flags on web. */
export default function Review() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { t, err } = useT();
  const q = useApi(['admin-application', id], () =>
    api.GET('/v1/admin/vet-applications/{id}', { params: { path: { id } } }),
  );
  const [reasons, setReasons] = useState<ApplicationReason[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const a = t.web.admin;
  const r = q.data;
  if (!r)
    return (
      <Screen title={a.queue} role="admin">
        <Loading label={t.web.common.loading} />
      </Screen>
    );
  const path = { params: { path: { id } } };
  const label = (f: string) => (t.web.application.fields as Record<string, string>)[f] ?? f;

  const run = async (fn: () => Promise<{ error?: unknown }>) => {
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) return setError(err(e as { code: string }));
      setDone(true);
      await q.refetch();
    } catch {
      setError(t.web.common.offline);
    }
  };
  const decide = (decision: ApplicationDecision) =>
    run(() =>
      api.POST('/v1/admin/vet-applications/{id}/decision', {
        ...path,
        body: {
          decision,
          reasons,
          ...(note && { note }),
          ...(decision === 'request_changes' && {
            flaggedFields: r.documents.map((d) => `doc.${d.kind}`),
          }),
        },
      }),
    );
  const reviewable = r.status === 'submitted' || r.status === 'under_review';

  return (
    <Screen title={`${r.reference} · ${t.web.application.states[r.status]}`} role="admin">
      <Card>
        <H2>{a.applicant}</H2>
        <P>{`${r.applicant.name ?? '-'} · ${r.applicant.phone ?? '-'}`}</P>
        <P>{`${a.nationalId}: ${r.nationalId ?? '-'}`}</P>
        {r.duplicates.length > 0 ? (
          <Notice tone="warning">{`${a.duplicates}: ${r.duplicates.length}`}</Notice>
        ) : (
          <P muted>{a.noDuplicates}</P>
        )}
      </Card>
      {APPLICATION_STEPS.map((step) => (
        <Card key={step}>
          <H2>{t.web.application.steps[step]}</H2>
          {Object.entries(r.steps[step] ?? {}).map(([k, v]) => (
            <P key={k}>{`${label(k)}: ${show(v)}`}</P>
          ))}
        </Card>
      ))}
      <Card>
        <H2>{t.web.application.documents}</H2>
        {r.documents.map((d) => (
          <Button
            key={d.id}
            variant="secondary"
            title={`${a.viewDocument}: ${t.web.application.docKinds[d.kind]}`}
            onPress={async () => {
              const { data } = await api.GET('/v1/admin/vet-documents/{id}/url', {
                params: { path: { id: d.id } },
              });
              if (data) await Linking.openURL(data.url);
            }}
          />
        ))}
      </Card>
      {r.status === 'submitted' && (
        <Button
          title={a.claim}
          onPress={() =>
            void run(() =>
              api.POST('/v1/admin/vet-applications/{id}/claim', {
                ...path,
                body: { force: false },
              }),
            )
          }
        />
      )}
      {reviewable && (
        <Card>
          <H2>{a.reasons}</H2>
          <Choices
            multi
            options={APPLICATION_REASONS.map((x) => ({
              value: x,
              label: t.application.reasons[x],
            }))}
            value={reasons}
            onChange={(x) =>
              setReasons((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]))
            }
          />
          <Field
            label={a.noteToVet}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={500}
          />
          <Button title={a.approve} onPress={() => void decide('approve')} />
          <Button
            title={a.requestChanges}
            variant="secondary"
            disabled={reasons.length === 0}
            onPress={() => void decide('request_changes')}
          />
          <Button
            title={a.reject}
            variant="danger"
            disabled={reasons.length === 0}
            onPress={() => void decide('reject')}
          />
        </Card>
      )}
      {done && <Notice tone="success">{a.decisionSaved}</Notice>}
      <ErrorText message={error} />
    </Screen>
  );
}
