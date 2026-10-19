import { router } from 'expo-router';
import { useState } from 'react';
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
import { Countdown } from '../../src/components/countdown';
import { EmptyState } from '../../src/components/pictures';
import { PriceLines } from '../../src/components/prices';
import { FollowUpList } from '../../src/components/follow-ups';
import { PhotoStrip } from '../../src/components/photo-strip';
import { AppointmentLine } from '../../src/components/when-picker';

/** Vet home (§8.3): online toggle, live offers with countdown, active jobs. */
export default function VetHome() {
  const { t, fmt, err } = useT();
  const { me } = useSession();
  const approved = me?.vet?.verificationStatus === 'approved';
  const profile = useApi(['vet-profile'], () => api.GET('/v1/vets/me'), { cache: 'vet:profile' });
  // Follow-ups change slowly: read them once a minute (§24.4).
  const followUps = useApi(['vet-follow-ups'], () => api.GET('/v1/vets/me/follow-ups'), {
    cache: 'vet:follow-ups',
    refetchInterval: 60_000,
  });
  const upcoming = (followUps.data ?? []).filter((f) => !f.rebookedBookingId);
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
  const open = ((jobs.data ?? []) as Schemas['VetJob'][]).filter(
    (j) => !TERMINAL_BOOKING_STATUSES.includes(j.status),
  );
  // §24.10: booked visits not yet set off for, soonest first; the rest is today's work.
  const appointments = open
    .filter((j) => j.scheduledFor && j.status === 'matched')
    .sort((x, y) => (x.scheduledFor ?? '').localeCompare(y.scheduledFor ?? ''));
  const active = open.filter((j) => !appointments.includes(j));
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
        {approved && (profile.data?.practiceMissing ?? []).length > 0 && (
          <Notice tone="warning">{t.errors.practice_incomplete}</Notice>
        )}
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
        {(offers.data ?? []).length === 0 && <EmptyState kind="noOffers" text={v.noOffers} />}
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
              {o.kind === 'direct' && <Badge tone="success">{t.web.choose.farmerChoseYou}</Badge>}
            </View>
            <P>{`${o.ward.ward} (${o.ward.subCounty})`}</P>
            <AppointmentLine scheduledFor={o.scheduledFor} part={o.scheduledPart} />
            <PhotoStrip urls={o.photos} />
            {o.price ? (
              <PriceLines price={o.price} forVet />
            ) : (
              <P>{fmt(t.web.common.kes, { amount: o.feeQuoted })}</P>
            )}
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
      {appointments.length > 0 && (
        <Card>
          <H2>{t.web.schedule.upcomingTitle}</H2>
          {appointments.map((j) => (
            <Pressable
              key={j.id}
              accessibilityRole="link"
              onPress={() => router.push(`/vet/job/${j.id}`)}
              style={{ backgroundColor: colors.canvas, padding: space.sm, borderRadius: 8 }}
            >
              <AppointmentLine scheduledFor={j.scheduledFor} part={j.scheduledPart} />
              <P>{`${fmt(t.web.tracking.title, { ref: j.id })}: ${t.ussd.species[j.species]} · ${j.ward.ward}`}</P>
            </Pressable>
          ))}
        </Card>
      )}
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
      {upcoming.length > 0 && (
        <Card>
          <H2>{t.web.followUps.title}</H2>
          <FollowUpList items={upcoming.slice(0, 3)} />
          <Button
            variant="ghost"
            title={t.web.followUps.seeAll}
            onPress={() => router.push('/vet/follow-ups')}
          />
        </Card>
      )}
      {!approved && <Notice tone="warning">{t.web.application.cannotWork}</Notice>}
      <View style={s.row}>
        <Button
          variant="secondary"
          title={v.jobHistory}
          onPress={() => router.push('/vet/history')}
        />
        <Button
          variant="secondary"
          title={t.web.ratings.title}
          onPress={() => router.push('/vet/ratings')}
        />
        <Button
          variant="secondary"
          title={t.web.vetProfile.title}
          onPress={() => router.push('/vet/profile')}
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
