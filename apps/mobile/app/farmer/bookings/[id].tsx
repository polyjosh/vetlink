import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { CANCEL_REASONS, TERMINAL_BOOKING_STATUSES, type CancelReason } from '@vetlink/shared';
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
  Notice,
  P,
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

/** Tracking (§8.2 step 7): progress, vet contact once matched, cancel with policy, rating. */
export default function Tracking() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { t, fmt, err, lang } = useT();
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
    >
      {b.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
      <Card>
        <H2>{t.ussd.statuses[b.status]}</H2>
        <P>
          {t.ussd.species[b.species]}, {t.ussd.problems[b.problemType]} · {b.ward.ward}
        </P>
        {b.services.length > 0 && (
          <P>{`${t.web.prices.consultation} + ${b.services.map((x) => t.web.application.services[x]).join(', ')}`}</P>
        )}
        <PhotoStrip urls={b.photos} />
        {b.price ? (
          <PriceLines price={b.price} />
        ) : (
          <PriceRangeLines range={b.priceRange} bookingFee={b.depositKes} />
        )}
        <P testID="deposit-status">{tr.depositStatus[b.deposit.status]}</P>
      </Card>
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
      {b.vet && (
        <Card>
          <View style={s.row}>
            <PersonAvatar url={b.vet.photoUrl} name={b.vet.name} size={56} />
            <View style={{ flex: 1 }}>
              <H2>{fmt(tr.vetComing, { vet: b.vet.name ?? '' })}</H2>
              {b.vet.displayName && <P muted>{`“${b.vet.displayName}”`}</P>}
              <BadgeChips badges={b.vet.badges ?? []} />
            </View>
          </View>
          {b.vet.phone && (
            <Button
              title={tr.callVet}
              onPress={() => void Linking.openURL(`tel:+${b.vet?.phone ?? ''}`)}
            />
          )}
        </Card>
      )}
      <Card>
        <H2>{tr.timeline}</H2>
        <P>{`${tr.created} · ${new Date(b.createdAt).toLocaleString(lang)}`}</P>
        {b.timeline.map((e) => (
          <P
            key={`${e.event}-${e.at}`}
          >{`${t.ussd.statuses[e.status]} · ${new Date(e.at).toLocaleString(lang)}`}</P>
        ))}
      </Card>
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
            <Button variant="secondary" title={tr.cancel} onPress={() => setCancelling(true)} />
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
