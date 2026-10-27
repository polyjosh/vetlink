import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, layout, radius, size, space, type } from '@vetlink/ui-tokens';
import {
  CANCEL_REASONS,
  TERMINAL_BOOKING_STATUSES,
  trackingSteps,
  type CancelReason,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { Screen } from '../../../src/components/screen';
import {
  Badge,
  Button,
  Card,
  Choices,
  ErrorText,
  Field,
  H2,
  Loading,
  Icon,
  Notice,
  P,
  PersonRow,
  StatusChip,
  Text,
  Timeline,
  s,
} from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';
import { PersonAvatar } from '../../../src/components/pictures';
import { PriceLines, PriceRangeLines } from '../../../src/components/prices';
import { BadgeChips, TagChips } from '../../../src/components/ratings';
import { ratingTagsFor, type RatingTag } from '@vetlink/shared';
import { Countdown } from '../../../src/components/countdown';
import { VetChooser, type VetSort } from '../../../src/components/vet-chooser';
import { CHOICES_BEFORE_AUTO_HINT } from '@vetlink/shared';
import { PhotoStrip } from '../../../src/components/photo-strip';
import { AppointmentLine } from '../../../src/components/when-picker';

/** Tracking (§8.2 step 7): progress, vet contact once matched, cancel with policy, rating. */
export default function Tracking() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { t, fmt, err, lang } = useT();
  const insets = useSafeAreaInsets();
  const q = useApi(
    ['booking', id],
    () => api.GET('/v1/bookings/{id}', { params: { path: { id } } }),
    {
      cache: `booking:${id}`,
      refetchInterval: 5_000,
    },
  );
  const b = q.data as Schemas['FarmerBooking'] | undefined;
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = t.web.tracking;
  // §24.6: vets to choose from again, after the chosen one could not come.
  const [sort, setSort] = useState<VetSort>('distance');
  const [again, setAgain] = useState<string | null>(null);
  const vets = useApi(
    ['choose-again', id, sort],
    () => api.GET('/v1/bookings/{id}/vets', { params: { path: { id }, query: { sort } } }),
    { enabled: b?.status === 'vet_unavailable' },
  );

  if (!b)
    return (
      <Screen title={fmt(tr.title, { ref: id })} role="farmer">
        {q.error ? (
          <ErrorText message={t.web.common.somethingWrong} />
        ) : (
          <Loading label={t.web.common.loading} />
        )}
      </Screen>
    );

  const act = async (fn: () => Promise<{ error?: unknown }>) => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await fn();
      if (e) setError(err(e as { code: string }));
    } catch {
      setError(t.web.common.offline);
    }
    setBusy(false);
    await q.refetch();
  };
  const path = { params: { path: { id: b.id } } };
  const live = !TERMINAL_BOOKING_STATUSES.includes(b.status);

  return (
    <Screen
      title={fmt(tr.title, { ref: b.id })}
      role="farmer"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      header={
        <View style={[st.band, { paddingTop: insets.top + space[3] }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.web.common.back}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/farmer'))}
            style={st.back}
          >
            <Icon name="chevronLeft" />
          </Pressable>
          <View style={st.where}>
            <Icon name="mapPin" size={size.iconSm} color={color.primary} />
            <Text style={st.whereText}>{fmt(tr.where, { ward: b.ward.ward })}</Text>
          </View>
        </View>
      }
    >
      <View style={st.sheet}>
        <View style={s.row}>
          <StatusChip status={b.status} testID="booking-status" />
          {b.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
        </View>
        <Text accessibilityRole="header" style={st.headline}>
          {b.vet && !TERMINAL_BOOKING_STATUSES.includes(b.status)
            ? fmt(tr.vetComing, { vet: b.vet.name ?? '' })
            : t.ussd.statuses[b.status]}
        </Text>
        <Text style={st.meta}>
          {fmt(tr.metaLine, {
            animal: t.ussd.species[b.species],
            problem: t.ussd.problems[b.problemType],
            ref: fmt(tr.title, { ref: b.id }),
          })}
        </Text>
        <AppointmentLine scheduledFor={b.scheduledFor} part={b.scheduledPart} />
        {b.overdue && <Notice tone="warning">{t.web.schedule.overdue}</Notice>}
        {b.vet && (
          <Card style={st.inner}>
            <PersonRow
              name={b.vet.name ?? ''}
              photoUrl={b.vet.photoUrl}
              verified
              phone={b.vet.phone}
              meta={`${b.vet.type === 'vet' ? t.web.onboarding.vetTypeVet : t.web.onboarding.vetTypeParavet}${b.vet.displayName ? ` · “${b.vet.displayName}”` : ''}`}
            />
            <BadgeChips badges={b.vet.badges ?? []} />
          </Card>
        )}
        <Card style={st.inner}>
          <Timeline
            steps={trackingSteps(b).map((x) => ({
              key: x.step ?? 'created',
              label: x.step ? t.ussd.statuses[x.step] : tr.stepRequested,
              state: x.state,
              meta: x.at
                ? new Date(x.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
                : undefined,
            }))}
          />
        </Card>
        {b.services.length > 0 && (
          <P>{`${t.web.prices.consultation} + ${b.services.map((x) => t.web.application.services[x]).join(', ')}`}</P>
        )}
        {b.price ? (
          <PriceLines price={b.price} />
        ) : (
          <PriceRangeLines range={b.priceRange} bookingFee={b.depositKes} />
        )}
        <P testID="deposit-status">{tr.depositStatus[b.deposit.status]}</P>
        <PhotoStrip urls={b.photos} />
      </View>
      {b.status === 'requested' && (
        <Card>
          <View style={s.row}>
            <PersonAvatar url={b.requestedVet?.photoUrl} name={b.requestedVet?.name} size={48} />
            <View style={{ flex: 1 }}>
              <H2>{fmt(t.web.choose.waitingTitle, { vet: b.requestedVet?.name ?? '' })}</H2>
            </View>
            {b.statusDeadlineAt && <Countdown until={b.statusDeadlineAt} />}
          </View>
          <P muted>{t.web.choose.waitingHint}</P>
        </Card>
      )}
      {b.status === 'awaiting_deposit' && (
        <Card>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <H2>{fmt(t.web.choose.payTitle, { vet: b.vet?.name ?? '' })}</H2>
            </View>
            {b.statusDeadlineAt && <Countdown until={b.statusDeadlineAt} />}
          </View>
          <P>{fmt(t.web.choose.payHint, { amount: b.depositKes })}</P>
          <Button
            title={t.web.choose.payNow}
            disabled={busy || b.deposit.status === 'pending'}
            onPress={() =>
              void act(() => api.POST('/v1/payments/stk', { body: { bookingId: b.id } }))
            }
          />
        </Card>
      )}
      {b.status === 'vet_unavailable' && (
        <Card>
          <H2>{t.web.choose.unavailableTitle}</H2>
          <P muted>{t.web.choose.unavailableHint}</P>
          {b.directChoices >= CHOICES_BEFORE_AUTO_HINT && (
            <Notice tone="warning">{t.web.choose.tryFastest}</Notice>
          )}
          <VetChooser
            vets={vets.data}
            value={again}
            onChange={setAgain}
            sort={sort}
            onSort={setSort}
          />
          <Button
            title={again === 'auto' ? t.web.choose.switchToAuto : t.web.choose.sendRequest}
            disabled={busy || !again}
            onPress={() =>
              void act(async () => {
                if (again === 'auto') {
                  const r = await api.POST('/v1/bookings/{id}/switch-to-auto', {
                    params: { path: { id: b.id } },
                  });
                  if (r.error) return r;
                  return api.POST('/v1/payments/stk', { body: { bookingId: b.id } });
                }
                return api.POST('/v1/bookings/{id}/rechoose', {
                  params: { path: { id: b.id } },
                  body: { vetId: again ?? '' },
                });
              })
            }
          />
        </Card>
      )}
      {b.status === 'pending_payment' && b.deposit.status === 'pending' && (
        <Notice tone="warning">{`${t.web.request.checkPhone}. ${fmt(t.web.request.checkPhoneHint, { amount: b.depositKes })}`}</Notice>
      )}
      {b.status === 'pending_payment' && b.deposit.status !== 'pending' && (
        <Card>
          {b.deposit.status === 'failed' && <P>{t.web.request.paymentFailed}</P>}
          <Button
            title={t.web.request.payAgain}
            disabled={busy}
            onPress={() =>
              void act(() => api.POST('/v1/payments/stk', { body: { bookingId: b.id } }))
            }
          />
        </Card>
      )}
      {b.status === 'pending' && <Notice>{t.web.request.searching}</Notice>}
      {b.treatment && (
        <Card>
          <H2>{tr.treatment}</H2>
          {b.treatment.diagnosis && <P>{`${tr.diagnosis}: ${b.treatment.diagnosis}`}</P>}
          {b.treatment.drugsUsed && <P>{`${tr.drugs}: ${b.treatment.drugsUsed}`}</P>}
          {b.treatment.followUpDate && <P>{`${tr.followUp}: ${b.treatment.followUpDate}`}</P>}
          {b.treatment.followUpDate && !b.treatment.followUpBookingId && b.vet && (
            <Button
              variant="secondary"
              title={fmt(t.web.bookAgain.followUp, { vet: b.vet.name ?? '' })}
              onPress={() =>
                router.push(
                  `/farmer/request?vet=${b.vet?.id ?? ''}&followUp=${b.treatment?.id ?? ''}`,
                )
              }
            />
          )}
        </Card>
      )}
      {b.status === 'done' && !b.rating && (
        <Card>
          <H2>{tr.rateTitle}</H2>
          <View style={s.row}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                title={`${n}★`}
                variant={stars >= n ? 'primary' : 'secondary'}
                onPress={() => {
                  setStars(n);
                  setTags(tags.filter((x) => ratingTagsFor(n).includes(x)));
                }}
              />
            ))}
          </View>
          <TagChips stars={stars} value={tags} onChange={setTags} />
          <Field label={tr.comment} value={comment} onChangeText={setComment} maxLength={500} />
          <Button
            title={tr.rateSubmit}
            disabled={!stars || busy}
            onPress={() =>
              void act(() =>
                api.POST('/v1/bookings/{id}/rating', {
                  ...path,
                  body: { stars, tags, ...(comment && { comment }) },
                }),
              )
            }
          />
        </Card>
      )}
      {b.rating && <Notice tone="success">{tr.rated}</Notice>}
      {live && b.actions.includes('farmer_cancelled') && (
        <Card>
          {!cancelling ? (
            <Button
              variant="danger"
              size="lg"
              title={tr.cancel}
              onPress={() => setCancelling(true)}
            />
          ) : (
            <>
              <H2>{tr.cancelTitle}</H2>
              <Choices
                options={CANCEL_REASONS.map((x) => ({ value: x, label: tr.cancelReasons[x] }))}
                value={reason}
                onChange={setReason}
              />
              <P muted>{tr.cancelPolicy}</P>
              <Button
                variant="danger"
                title={tr.cancelConfirm}
                disabled={!reason || busy}
                onPress={() =>
                  void act(() =>
                    api.POST('/v1/bookings/{id}/cancel', {
                      ...path,
                      body: { reason: reason ?? 'other' },
                    }),
                  )
                }
              />
            </>
          )}
        </Card>
      )}
      <ErrorText message={error} />
    </Screen>
  );
}

const st = StyleSheet.create({
  band: {
    height: space[16] * 3,
    backgroundColor: color.primarySoft,
    paddingHorizontal: layout.mobileGutter,
    paddingBottom: space[8],
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  back: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  where: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  whereText: { fontSize: type.small.size, fontWeight: '700', color: color.primary },
  sheet: {
    marginTop: -(layout.sheetOverlap + space[4]),
    marginHorizontal: -layout.mobileGutter,
    paddingHorizontal: layout.mobileGutter,
    paddingTop: space[5],
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: color.ground,
    gap: space[2],
    marginBottom: space[3],
  },
  headline: {
    fontSize: type.title.size,
    lineHeight: type.title.line,
    fontWeight: '800',
    marginTop: space[1],
  },
  meta: { fontSize: type.small.size, color: color.inkMuted },
  inner: { marginBottom: 0, marginTop: space[2] },
});
