import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import type { BookingStatus } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { Screen } from '../../../src/components/screen';
import { SyncFailures } from '../../../src/components/sync-failures';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  H2,
  Loading,
  Notice,
  P,
  s,
} from '../../../src/components/ui';
import { enqueue, useSync } from '../../../src/offline/sync';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';
import { PersonAvatar } from '../../../src/components/pictures';

/** Directions open in the phone's maps app (no map SDK yet: owner decision). */
function directions(job: Schemas['VetJob']): string {
  const dest = job.location
    ? `${job.location.lat},${job.location.lng}`
    : `${job.ward.ward}, ${job.ward.county}, Kenya`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/**
 * The job (§8.3) works offline: "on my way", "arrived" and the completion notes go to the outbox
 * and show at once; they are sent when the connection returns. The server state machine wins.
 */
export default function Job() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { t, fmt, err } = useT();
  const q = useApi(
    ['booking', id],
    () => api.GET('/v1/bookings/{id}', { params: { path: { id } } }),
    {
      cache: `job:${id}`,
      refetchInterval: 10_000,
    },
  );
  const job = q.data as Schemas['VetJob'] | undefined;
  const queued = useSync((st) =>
    st.items.filter((i) => i.state === 'pending' && 'bookingId' in i.op && i.op.bookingId === id),
  );
  const [diagnosis, setDiagnosis] = useState('');
  const [drugs, setDrugs] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const v = t.web.vet;

  if (!job)
    return (
      <Screen title={fmt(t.web.tracking.title, { ref: id })} role="vet">
        {q.error ? (
          <Button title={t.web.common.home} onPress={() => router.replace('/vet')} />
        ) : (
          <Loading label={t.web.common.loading} />
        )}
      </Screen>
    );

  // What the vet sees: the server's status, moved forward by steps still waiting to be sent.
  let status: BookingStatus = job.status;
  for (const i of queued) {
    if (i.op.kind === 'booking_status') status = i.op.status;
    if (i.op.kind === 'booking_complete') status = 'done';
  }
  const can = (step: 'en_route' | 'in_service' | 'done') =>
    queued.length > 0
      ? (step === 'en_route' && status === 'matched') ||
        (step === 'in_service' && status === 'en_route') ||
        (step === 'done' && status === 'in_service')
      : job.actions.includes(
          step === 'en_route'
            ? 'vet_en_route'
            : step === 'in_service'
              ? 'vet_arrived'
              : 'vet_completed',
        );

  return (
    <Screen
      title={fmt(t.web.tracking.title, { ref: job.id })}
      role="vet"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <SyncFailures />
      <Card>
        <View style={s.row}>
          {job.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
          <H2>{t.ussd.statuses[status]}</H2>
        </View>
        <P>{`${t.ussd.species[job.species]}, ${t.ussd.problems[job.problemType]}`}</P>
        {job.note && <P>{`“${job.note}”`}</P>}
        <P>{fmt(t.web.common.kes, { amount: job.feeQuoted })}</P>
      </Card>
      {queued.length > 0 && <Notice tone="warning">{t.web.mobile.savedOffline}</Notice>}
      <Card>
        <View style={s.row}>
          <PersonAvatar
            url={job.farmer.photoUrl}
            name={job.farmer.displayName ?? job.farmer.name}
            size={48}
          />
          <P>{`${v.farmer}: ${job.farmer.displayName ?? job.farmer.name ?? '-'}`}</P>
        </View>
        <P>{`${job.ward.ward}, ${job.ward.subCounty}`}</P>
        {job.farmer.farmNotes && <P>{`${v.landmarks}: ${job.farmer.farmNotes}`}</P>}
        <View style={s.row}>
          {job.farmer.phone && (
            <Button
              title={t.web.common.call}
              onPress={() => void Linking.openURL(`tel:+${job.farmer.phone ?? ''}`)}
            />
          )}
          <Button
            title={v.navigate}
            variant="secondary"
            onPress={() => void Linking.openURL(directions(job))}
          />
        </View>
      </Card>
      {can('en_route') && (
        <Button
          big
          title={v.onMyWay}
          onPress={() =>
            void enqueue({ kind: 'booking_status', bookingId: id, status: 'en_route' })
          }
          testID="on-my-way"
        />
      )}
      {can('in_service') && (
        <Button
          big
          title={v.arrived}
          onPress={() =>
            void enqueue({ kind: 'booking_status', bookingId: id, status: 'in_service' })
          }
          testID="arrived"
        />
      )}
      {queued.length === 0 && job.actions.includes('vet_released') && (
        <Button
          variant="secondary"
          title={v.release}
          onPress={async () => {
            try {
              const { error: e } = await api.POST('/v1/bookings/{id}/release', {
                params: { path: { id } },
              });
              if (e) return setError(err(e));
              router.replace('/vet');
            } catch {
              setError(t.web.common.offline);
            }
          }}
        />
      )}
      {can('done') && (
        <Card>
          <H2>{v.completeTitle}</H2>
          <Field
            label={v.diagnosis}
            value={diagnosis}
            onChangeText={setDiagnosis}
            maxLength={200}
            testID="diagnosis"
          />
          <Field label={v.drugs} value={drugs} onChangeText={setDrugs} maxLength={500} />
          <Field label={v.notes} value={notes} onChangeText={setNotes} multiline maxLength={2000} />
          <Field
            label={`${v.followUp} (${t.web.common.optional})`}
            placeholder="YYYY-MM-DD"
            value={followUp}
            onChangeText={setFollowUp}
            maxLength={10}
          />
          <Button
            big
            title={v.complete}
            testID="complete"
            disabled={!!followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp)}
            onPress={() =>
              void enqueue({
                kind: 'booking_complete',
                bookingId: id,
                body: {
                  ...(diagnosis && { diagnosis }),
                  ...(drugs && { drugsUsed: drugs }),
                  ...(notes && { notes }),
                  ...(followUp && { followUpDate: followUp }),
                  clientCreatedAt: new Date().toISOString(),
                },
              })
            }
          />
        </Card>
      )}
      {status === 'done' && <Notice tone="success">{v.completed}</Notice>}
      <ErrorText message={error} />
    </Screen>
  );
}
