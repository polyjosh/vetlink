'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  CANCEL_REASONS,
  trackingSteps,
  TERMINAL_BOOKING_STATUSES,
  CHOICES_BEFORE_AUTO_HINT,
  ratingTagsFor,
  type CancelReason,
  type RatingTag,
} from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { Shell } from '@/components/shell';
import {
  Badge,
  Button,
  Card,
  ChoiceGrid,
  ErrorBox,
  Field,
  Input,
  Notice,
  LinkButton,
  PersonRow,
  Spinner,
  StatusChip,
  Timeline,
  Icon,
} from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { Countdown } from '@/components/countdown';
import { PersonAvatar } from '@/components/pictures';
import { VetChooser, type VetSort } from '@/components/vet-chooser';
import { PriceLines, PriceRangeLines } from '@/components/prices';
import { BadgeChips, TagChips } from '@/components/ratings';
import { PhotoStrip } from '@/components/photo-strip';
import { AppointmentLine } from '@/components/when-picker';

/** Tracking (§8.2 step 7): timeline, vet contact once matched, cancel with policy, then rating. */
export default function Tracking() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [b, setB] = useState<Schemas['FarmerBooking'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [stars, setStars] = useState<number>(0);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // §24.6: vets to choose from again, after the chosen one could not come.
  const [sort, setSort] = useState<VetSort>('distance');
  const [again, setAgain] = useState<string | null>(null);
  const [vets, setVets] = useState<Schemas['ChoosableVet'][] | null>(null);
  const unavailable = b?.status === 'vet_unavailable';
  useEffect(() => {
    if (!unavailable) return;
    void api
      .GET('/v1/bookings/{id}/vets', { params: { path: { id: Number(id) }, query: { sort } } })
      .then(({ data }) => setVets(data ?? []));
  }, [api, id, unavailable, sort]);

  const load = useCallback(async () => {
    const { data, error: e } = await api.GET('/v1/bookings/{id}', {
      params: { path: { id: Number(id) } },
    });
    if (e) setError(errorText(lang, e));
    else setB(data as Schemas['FarmerBooking']);
  }, [api, id, lang]);
  const live =
    !b || !TERMINAL_BOOKING_STATUSES.includes(b.status) || b.deposit.status === 'pending';
  // Server state only: the app never decides a payment succeeded (invariant 4).
  const waiting = b?.status === 'requested' || b?.status === 'awaiting_deposit';
  usePoll(load, b?.deposit.status === 'pending' || waiting ? 3_000 : 10_000, live);

  if (!b)
    return (
      <Shell title={fmt(t.web.tracking.title, { ref: id })} role="farmer" nav={<FarmerNav />}>
        {error ? <ErrorBox message={error} /> : <Spinner label={t.web.common.loading} />}
      </Shell>
    );

  const act = async (fn: () => Promise<{ error?: unknown }>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(errorText(lang, e as { code: string; message_key: string }));
    await load();
  };

  return (
    <Shell title={fmt(t.web.tracking.title, { ref: b.id })} role="farmer" nav={<FarmerNav />}>
      <div className="space-y-4">
        <div
          aria-hidden
          className="flex h-36 items-start justify-between rounded-lg bg-primary-soft bg-[radial-gradient(var(--vl-color-border)_1px,transparent_1px)] [background-size:16px_16px] p-4 text-primary"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-small font-bold shadow-raised">
            <Icon name="mapPin" size={18} />
            {fmt(t.web.tracking.where, { ward: b.ward.ward })}
          </span>
          {b.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
        </div>
        <Card raised className="relative -mt-12 space-y-4 !rounded-sheet">
          <StatusChip status={b.status} testId="booking-status" />
          <div>
            <h2 className="text-title">
              {b.vet && !TERMINAL_BOOKING_STATUSES.includes(b.status)
                ? fmt(t.web.tracking.vetComing, { vet: b.vet.name ?? '' })
                : t.ussd.statuses[b.status]}
            </h2>
            <p className="mt-1 text-small text-ink-muted">
              {fmt(t.web.tracking.metaLine, {
                animal: t.ussd.species[b.species],
                problem: t.ussd.problems[b.problemType],
                ref: fmt(t.web.tracking.title, { ref: b.id }),
              })}
            </p>
            <AppointmentLine scheduledFor={b.scheduledFor} part={b.scheduledPart} />
          </div>
          {b.overdue && <Notice tone="warning">{t.web.schedule.overdue}</Notice>}
          {b.vet && (
            <div className="space-y-2 border-t border-divider pt-4">
              <PersonRow
                name={b.vet.name ?? ''}
                photoUrl={b.vet.photoUrl}
                verified
                phone={b.vet.phone}
                meta={
                  <>
                    {b.vet.type === 'vet'
                      ? t.web.onboarding.vetTypeVet
                      : t.web.onboarding.vetTypeParavet}
                    {b.vet.displayName && ` · “${b.vet.displayName}”`}
                  </>
                }
              />
              <BadgeChips badges={b.vet.badges} />
            </div>
          )}
          <div className="border-t border-divider pt-4">
            <h3 className="sr-only">{t.web.tracking.timeline}</h3>
            <Timeline
              steps={trackingSteps(b).map((x) => ({
                key: x.step ?? 'created',
                label: x.step ? t.ussd.statuses[x.step] : t.web.tracking.stepRequested,
                state: x.state,
                meta: x.at
                  ? new Date(x.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
                  : undefined,
              }))}
            />
          </div>
          <div className="space-y-2 border-t border-divider pt-4">
            {b.services.length > 0 && (
              <p>
                {t.web.prices.consultation} +{' '}
                {b.services.map((s) => t.web.application.services[s]).join(', ')}
              </p>
            )}
            {b.price ? (
              <PriceLines price={b.price} />
            ) : (
              <PriceRangeLines range={b.priceRange} bookingFee={b.depositKes} />
            )}
            <p className="text-small font-semibold" data-testid="deposit-status">
              {t.web.tracking.depositStatus[b.deposit.status]}
            </p>
          </div>
          <PhotoStrip urls={b.photos} />
        </Card>

        {b.status === 'requested' && (
          <Card className="space-y-2 border-warning">
            <div className="flex items-center gap-3">
              <PersonAvatar url={b.requestedVet?.photoUrl} name={b.requestedVet?.name} size={48} />
              <p className="flex-1 font-bold">
                {fmt(t.web.choose.waitingTitle, { vet: b.requestedVet?.name ?? '' })}
              </p>
              {b.statusDeadlineAt && <Countdown until={b.statusDeadlineAt} />}
            </div>
            <p className="text-muted">{t.web.choose.waitingHint}</p>
          </Card>
        )}
        {b.status === 'awaiting_deposit' && (
          <Card className="space-y-2 border-brand">
            <div className="flex items-center gap-3">
              <p className="flex-1 text-lg font-bold">
                {fmt(t.web.choose.payTitle, { vet: b.vet?.name ?? '' })}
              </p>
              {b.statusDeadlineAt && <Countdown until={b.statusDeadlineAt} />}
            </div>
            <p>{fmt(t.web.choose.payHint, { amount: b.depositKes })}</p>
            <Button
              className="w-full"
              disabled={busy || b.deposit.status === 'pending'}
              onClick={() =>
                void act(() => api.POST('/v1/payments/stk', { body: { bookingId: b.id } }))
              }
            >
              {t.web.choose.payNow}
            </Button>
          </Card>
        )}
        {b.status === 'vet_unavailable' && (
          <Card className="space-y-3">
            <h2 className="text-lg font-bold">{t.web.choose.unavailableTitle}</h2>
            <p className="text-muted">{t.web.choose.unavailableHint}</p>
            {b.directChoices >= CHOICES_BEFORE_AUTO_HINT && (
              <Notice tone="warning">{t.web.choose.tryFastest}</Notice>
            )}
            <VetChooser
              vets={vets}
              value={again}
              onChange={setAgain}
              sort={sort}
              onSort={setSort}
            />
            <Button
              className="w-full"
              disabled={busy || !again}
              onClick={() =>
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
            >
              {again === 'auto' ? t.web.choose.switchToAuto : t.web.choose.sendRequest}
            </Button>
          </Card>
        )}
        {b.status === 'pending_payment' && b.deposit.status === 'pending' && (
          <Notice tone="warning">
            <strong>{t.web.request.checkPhone}. </strong>
            {fmt(t.web.request.checkPhoneHint, { amount: b.depositKes })}
          </Notice>
        )}
        {b.status === 'pending_payment' && b.deposit.status !== 'pending' && (
          <Card className="space-y-2">
            {b.deposit.status === 'failed' && <p>{t.web.request.paymentFailed}</p>}
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                void act(() => api.POST('/v1/payments/stk', { body: { bookingId: b.id } }))
              }
            >
              {t.web.request.payAgain}
            </Button>
          </Card>
        )}
        {b.status === 'pending' && <Notice>{t.web.request.searching}</Notice>}

        {b.treatment && (
          <Card className="space-y-1">
            <h2 className="font-bold">{t.web.tracking.treatment}</h2>
            {b.treatment.diagnosis && (
              <p>
                {t.web.tracking.diagnosis}: {b.treatment.diagnosis}
              </p>
            )}
            {b.treatment.drugsUsed && (
              <p>
                {t.web.tracking.drugs}: {b.treatment.drugsUsed}
              </p>
            )}
            {b.treatment.followUpDate && (
              <p>
                {t.web.tracking.followUp}: {b.treatment.followUpDate}
              </p>
            )}
            {b.treatment.followUpDate && !b.treatment.followUpBookingId && b.vet && (
              <LinkButton
                variant="secondary"
                href={`/farmer/request?vet=${b.vet.id}&followUp=${b.treatment.id}`}
              >
                {fmt(t.web.bookAgain.followUp, { vet: b.vet.name ?? '' })}
              </LinkButton>
            )}
          </Card>
        )}

        {b.status === 'done' && !b.rating && (
          <Card className="space-y-3">
            <h2 className="font-bold">{t.web.tracking.rateTitle}</h2>
            <div className="flex gap-2" role="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n}`}
                  onClick={() => {
                    setStars(n);
                    setTags(tags.filter((x) => ratingTagsFor(n).includes(x)));
                  }}
                  className={`min-h-touch min-w-touch rounded-control border text-2xl ${stars >= n ? 'border-warning bg-warning-light' : 'border-line'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <TagChips stars={stars} value={tags} onChange={setTags} />
            <Field label={t.web.tracking.comment}>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
            </Field>
            <Button
              disabled={!stars || busy}
              onClick={() =>
                void act(() =>
                  api.POST('/v1/bookings/{id}/rating', {
                    params: { path: { id: b.id } },
                    body: { stars, tags, ...(comment && { comment }) },
                  }),
                )
              }
            >
              {t.web.tracking.rateSubmit}
            </Button>
          </Card>
        )}
        {b.rating && <Notice tone="success">{t.web.tracking.rated}</Notice>}

        {b.actions.includes('farmer_cancelled') && (
          <div className="space-y-3">
            {!cancelling ? (
              <Button
                variant="danger"
                size="lg"
                className="w-full"
                onClick={() => setCancelling(true)}
              >
                {t.web.tracking.cancel}
              </Button>
            ) : (
              <Card className="space-y-3">
                <h2 className="font-bold">{t.web.tracking.cancelTitle}</h2>
                <ChoiceGrid
                  options={CANCEL_REASONS.map((r) => ({
                    value: r,
                    label: t.web.tracking.cancelReasons[r],
                  }))}
                  value={reason}
                  onChange={setReason}
                />
                <p className="text-small text-ink-muted">{t.web.tracking.cancelPolicy}</p>
                <Button
                  variant="danger"
                  className="w-full"
                  disabled={!reason || busy}
                  onClick={() =>
                    void act(() =>
                      api.POST('/v1/bookings/{id}/cancel', {
                        params: { path: { id: b.id } },
                        body: { reason: reason ?? 'other' },
                      }),
                    )
                  }
                >
                  {t.web.tracking.cancelConfirm}
                </Button>
              </Card>
            )}
          </div>
        )}
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
