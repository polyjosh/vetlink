import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TERMINAL_BOOKING_STATUSES, eatDateOf } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { color, layout, nativeShadow, radius, size, space, type } from '@vetlink/ui-tokens';
import { AppBar, Screen } from '../../src/components/screen';
import { SyncFailures } from '../../src/components/sync-failures';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  H2,
  Icon,
  Notice,
  P,
  StatusChip,
  Text,
  s,
} from '../../src/components/ui';
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
  const insets = useSafeAreaInsets();
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

  const today = eatDateOf(new Date());
  const jobsToday = ((jobs.data ?? []) as Schemas['VetJob'][]).filter(
    (j) => j.acceptedAt && eatDateOf(new Date(j.acceptedAt)) === today,
  ).length;
  const toggle = () =>
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
    });
  const stats = [
    { n: String(jobsToday), label: v.jobsToday },
    { n: profile.data?.rating != null ? profile.data.rating.toFixed(1) : '–', label: v.ratingStat },
    {
      n: profile.data ? fmt(v.radiusKm, { km: profile.data.serviceRadiusKm }) : '–',
      label: v.radiusStat,
    },
  ];

  const header = (
    <View style={[st.header, { paddingTop: insets.top }]}>
      <View style={st.appBar}>
        <AppBar role="vet" inverse />
      </View>
      <View style={st.headRow}>
        <View style={{ flex: 1 }}>
          {me?.name ? <Text style={st.name}>{me.name}</Text> : null}
          <Text accessibilityRole="header" style={st.title}>
            {t.web.ui.nav.jobs}
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: online, disabled: !approved || busy || !profile.data }}
          accessibilityLabel={v.availability}
          disabled={!approved || busy || !profile.data}
          onPress={toggle}
          testID="toggle-online"
          style={[st.switchWrap, (!approved || !profile.data) && { opacity: 0.5 }]}
        >
          <View style={[st.dot, { backgroundColor: online ? color.online : color.inkMuted }]} />
          <Text style={st.switchText}>{online ? v.online : v.offline}</Text>
          <View style={[st.track, { backgroundColor: online ? color.online : color.inkMuted }]}>
            <View style={[st.knob, online ? { right: space[1] } : { left: space[1] }]} />
          </View>
        </Pressable>
      </View>
      <View style={st.stats}>
        {stats.map((x) => (
          <View
            key={x.label}
            style={{ flex: 1 }}
            accessible
            accessibilityLabel={`${x.label}: ${x.n}`}
          >
            <Text style={st.statN}>{x.n}</Text>
            <Text style={st.statLabel}>{x.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const offerList = offers.data ?? [];
  return (
    <Screen
      title={v.homeTitle}
      role="vet"
      header={header}
      onRefresh={() => void offers.refetch()}
      refreshing={offers.isRefetching}
    >
      <View style={st.overlap}>
        {offerList.length === 0 && (
          <Card raised>
            <EmptyState kind="noOffers" text={v.noOffers} />
          </Card>
        )}
        {offerList.map((o) => (
          <View key={o.offerId} testID="offer" style={[st.offer, nativeShadow.overlay]}>
            <View style={st.band}>
              <Text style={st.bandText}>
                {[v.newRequest, o.isEmergency ? t.web.request.urgent : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <View style={s.row}>
                <Icon name="clock" size={size.iconSm} />
                <Countdown until={o.expiresAt} plain />
              </View>
            </View>
            <View style={st.offerBody}>
              {o.kind === 'direct' && <Badge tone="success">{t.web.choose.farmerChoseYou}</Badge>}
              <Text style={st.offerTitle}>
                {`${t.ussd.species[o.species]} · ${t.ussd.problems[o.problemType]}`}
              </Text>
              <View style={s.row}>
                <Icon name="mapPin" size={size.iconSm} color={color.inkMuted} />
                <Text>{`${o.ward.ward} (${o.ward.subCounty})`}</Text>
              </View>
              <AppointmentLine scheduledFor={o.scheduledFor} part={o.scheduledPart} />
              <PhotoStrip urls={o.photos} />
              <View style={st.priceBox}>
                {o.price ? (
                  <PriceLines price={o.price} forVet />
                ) : (
                  <P>{fmt(t.web.common.kes, { amount: o.feeQuoted })}</P>
                )}
              </View>
              <Button
                size="xl"
                icon="check"
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
        {offerList.length > 0 && <Text style={st.smsHint}>{v.smsHint}</Text>}
      </View>
      <SyncFailures />
      <ErrorText message={error} />
      {approved && (profile.data?.practiceMissing ?? []).length > 0 && (
        <Notice tone="warning">{t.errors.practice_incomplete}</Notice>
      )}
      {!approved && <Notice tone="warning">{v.notApproved}</Notice>}
      {online && <P muted>{t.web.mobile.alertsHint}</P>}
      {appointments.length > 0 && (
        <Card>
          <H2>{t.web.schedule.upcomingTitle}</H2>
          {appointments.map((j) => (
            <Pressable
              key={j.id}
              accessibilityRole="link"
              onPress={() => router.push(`/vet/job/${j.id}`)}
              style={st.jobRow}
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
            style={[st.jobRow, s.row]}
          >
            <Text
              style={{ flex: 1 }}
            >{`${fmt(t.web.tracking.title, { ref: j.id })}: ${t.ussd.species[j.species]} · ${j.ward.ward}`}</Text>
            <StatusChip status={j.status} />
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
          variant="ghost"
          title={t.web.followUps.title}
          onPress={() => router.push('/vet/follow-ups')}
        />
        <Button
          variant="ghost"
          title={t.web.application.statusTitle}
          onPress={() => router.push('/vet/status')}
        />
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { backgroundColor: color.ink, paddingBottom: space[16] + space[2], gap: space[4] },
  appBar: { marginBottom: -space[2] },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    paddingHorizontal: layout.mobileGutter,
  },
  name: { fontSize: type.small.size, color: color.inkInverseMuted },
  title: {
    fontSize: type.title.size,
    lineHeight: type.title.line,
    fontWeight: '800',
    color: color.onPrimary,
  },
  switchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.touchMin,
    paddingLeft: space[3],
    paddingRight: space[2],
    borderRadius: radius.pill,
    borderWidth: size.border,
    borderColor: color.inkMuted,
  },
  dot: { width: space[3], height: space[3], borderRadius: radius.pill },
  switchText: { fontSize: type.small.size, fontWeight: '700', color: color.onPrimary },
  track: { width: size.touchMin, height: space[6] + space[1], borderRadius: radius.pill },
  knob: {
    position: 'absolute',
    top: space[1],
    width: space[5],
    height: space[5],
    borderRadius: radius.pill,
    backgroundColor: color.surface,
  },
  stats: { flexDirection: 'row', gap: space[3], paddingHorizontal: layout.mobileGutter },
  statN: { fontSize: type.title.size, fontWeight: '800', color: color.onPrimary },
  statLabel: { fontSize: type.label.size, color: color.inkInverseMuted },
  overlap: { marginTop: -(space[12] + space[4] + space[4]), gap: space[3], marginBottom: space[4] },
  offer: { backgroundColor: color.surface, borderRadius: radius.xl, overflow: 'hidden' },
  band: {
    backgroundColor: color.accent,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  bandText: {
    fontSize: type.small.size,
    fontWeight: '800',
    letterSpacing: type.label.tracking,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  offerBody: { padding: space[4], gap: space[3] },
  offerTitle: { fontSize: type.title.size, lineHeight: type.title.line, fontWeight: '800' },
  priceBox: { backgroundColor: color.ground, borderRadius: radius.md, padding: space[3] },
  smsHint: { fontSize: type.label.size, color: color.inkMuted, textAlign: 'center' },
  jobRow: {
    minHeight: size.touchMin,
    backgroundColor: color.ground,
    padding: space[2],
    borderRadius: radius.sm,
  },
});
