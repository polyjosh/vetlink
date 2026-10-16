import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TERMINAL_BOOKING_STATUSES } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { colors, space } from '@vetlink/ui-tokens';
import { Screen } from '../../src/components/screen';
import { SyncFailures } from '../../src/components/sync-failures';
import { Badge, Button, Card, ErrorText, H2, Notice, P, s } from '../../src/components/ui';
import { enablePush } from '../../src/lib/push';
import { kv } from '../../src/lib/storage';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

function Countdown({ until }: { until: string }) {
  const { t, fmt } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  return (
    <Badge tone={left > 0 ? 'warning' : 'danger'}>
      {left > 0 ? fmt(t.web.vet.timeLeft, { seconds: left }) : t.web.vet.expired}
    </Badge>
  );
}

/** Vet home (§8.3): online toggle, live offers with countdown, active jobs. */
export default function VetHome() {
  const { t, fmt, err } = useT();
  const { me } = useSession();
  const approved = me?.vet?.verificationStatus === 'approved';
  const profile = useApi(['vet-profile'], () => api.GET('/v1/vets/me'), { cache: 'vet:profile' });
  const offers = useApi(['offers'], () => api.GET('/v1/vets/me/offers'), {
    refetchInterval: 5_000,
  });
  const jobs = useApi(
    ['bookings', 'vet'],
    () => api.GET('/v1/bookings', { params: { query: { as: 'vet', limit: 20 } } }),
    {
      cache: 'vet:jobs',
      refetchInterval: 15_000,
    },
  );
  const active = ((jobs.data ?? []) as Schemas['VetJob'][]).filter(
    (j) => !TERMINAL_BOOKING_STATUSES.includes(j.status),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alertsAsked, setAlertsAsked] = useState(() => kv.get('alerts_asked') === '1');
  const online = profile.data?.isAvailable ?? false;
  const v = t.web.vet;

  const act = async (fn: () => Promise<{ error?: unknown }>) => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) setError(err(e as { code: string }));
    } catch {
      setError(t.web.common.offline); // offers and availability need a live connection
    }
    setBusy(false);
    await Promise.all([profile.refetch(), offers.refetch(), jobs.refetch()]);
  };

  return (
    <Screen
      title={v.homeTitle}
      role="vet"
      onRefresh={() => void offers.refetch()}
      refreshing={offers.isRefetching}
    >
      <SyncFailures />
      <Card style={online ? { borderColor: colors.brand, borderWidth: 2 } : {}}>
        <H2>{online ? v.online : v.offline}</H2>
        <P muted>{approved ? v.onlineHint : v.notApproved}</P>
        <Button
          variant={online ? 'secondary' : 'primary'}
          title={online ? v.goOffline : v.goOnline}
          disabled={!approved || busy || !profile.data}
          testID="toggle-online"
          onPress={() =>
            void act(async () => {
              const res = await api.PATCH('/v1/vets/me/availability', {
                body: { isAvailable: !online },
              });
              // Going online is when job alerts matter: ask for notifications here, once (§11).
              if (!res.error && !online && !alertsAsked) {
                kv.set('alerts_asked', '1');
                setAlertsAsked(true);
                await enablePush();
              }
              return res;
            })
          }
        />
        {online && <P muted>{t.web.mobile.alertsHint}</P>}
      </Card>
      <ErrorText message={error} />
      <Card>
        <H2>{v.offers}</H2>
        {(offers.data ?? []).length === 0 && <P muted>{v.noOffers}</P>}
        {(offers.data ?? []).map((o) => (
          <View
            key={o.offerId}
            testID="offer"
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 10,
              padding: space.md,
              gap: space.sm,
            }}
          >
            <View style={s.row}>
              {o.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
              <Text
                style={{ fontWeight: '700' }}
              >{`${t.ussd.species[o.species]}, ${t.ussd.problems[o.problemType]}`}</Text>
              <Countdown until={o.expiresAt} />
            </View>
            <P>{`${o.ward.ward} (${o.ward.subCounty}) · ${fmt(t.web.common.kes, { amount: o.feeQuoted })}`}</P>
            <View style={s.row}>
              <Button
                title={v.accept}
                disabled={busy}
                onPress={() =>
                  void act(() =>
                    api.POST('/v1/bookings/{id}/offers/{offerId}/accept', {
                      params: { path: { id: o.bookingId, offerId: o.offerId } },
                    }),
                  )
                }
              />
              <Button
                title={v.decline}
                variant="secondary"
                disabled={busy}
                onPress={() =>
                  void act(() =>
                    api.POST('/v1/bookings/{id}/offers/{offerId}/decline', {
                      params: { path: { id: o.bookingId, offerId: o.offerId } },
                    }),
                  )
                }
              />
            </View>
          </View>
        ))}
      </Card>
      <Card>
        <H2>{v.activeJobs}</H2>
        {active.length === 0 && <P muted>{v.noJobs}</P>}
        {active.map((j) => (
          <Pressable
            key={j.id}
            accessibilityRole="link"
            onPress={() => router.push(`/vet/job/${j.id}`)}
            style={[
              s.row,
              { minHeight: 48, backgroundColor: colors.canvas, padding: space.sm, borderRadius: 8 },
            ]}
          >
            <Text
              style={{ flex: 1 }}
            >{`${fmt(t.web.tracking.title, { ref: j.id })}: ${t.ussd.species[j.species]} · ${j.ward.ward}`}</Text>
            <Text style={{ fontWeight: '700' }}>{t.ussd.statuses[j.status]}</Text>
          </Pressable>
        ))}
      </Card>
      {!approved && <Notice tone="warning">{t.web.application.cannotWork}</Notice>}
      <View style={s.row}>
        <Button
          variant="secondary"
          title={v.jobHistory}
          onPress={() => router.push('/vet/history')}
        />
        <Button
          variant="secondary"
          title={t.web.application.statusTitle}
          onPress={() => router.push('/vet/status')}
        />
      </View>
    </Screen>
  );
}
