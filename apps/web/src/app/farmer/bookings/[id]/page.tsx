'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  CANCEL_REASONS,
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
  Spinner,
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
        {b.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
        <Card className="space-y-2">
          <p className="text-xl font-bold" data-testid="booking-status">
            {t.ussd.statuses[b.status]}
          </p>
          <p>
            {t.ussd.species[b.species]}, {t.ussd.problems[b.problemType]} · {b.ward.ward}
          </p>
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
          <p data-testid="deposit-status">{t.web.tracking.depositStatus[b.deposit.status]}</p>
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

        {b.vet && (
          <Card className="space-y-2">
            <div className="flex items-center gap-3">
              <PersonAvatar url={b.vet.photoUrl} name={b.vet.name} size={56} />
              <div>
                <p className="font-bold">
                  {fmt(t.web.tracking.vetComing, { vet: b.vet.name ?? '' })}
                </p>
                {b.vet.displayName && <p className="text-muted">“{b.vet.displayName}”</p>}
                <BadgeChips badges={b.vet.badges} />
              </div>
            </div>
            {b.vet.phone && (
              <a
                href={`tel:+${b.vet.phone}`}
                className="inline-flex min-h-touch items-center rounded-control bg-brand px-4 font-semibold text-white"
              >
                {t.web.tracking.callVet}
              </a>
            )}
          </Card>
        )}

        <Card>
          <h2 className="mb-2 font-bold">{t.web.tracking.timeline}</h2>
          <ol className="space-y-1">
            <li>
              {t.web.tracking.created} · {new Date(b.createdAt).toLocaleString(lang)}
            </li>
            {b.timeline.map((e) => (
              <li key={`${e.event}-${e.at}`}>
                {t.ussd.statuses[e.status]} · {new Date(e.at).toLocaleString(lang)}
              </li>
            ))}
          </ol>
        </Card>

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
          <Card className="space-y-3">
            {!cancelling ? (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                {t.web.tracking.cancel}
              </Button>
            ) : (
              <>
                <h2 className="font-bold">{t.web.tracking.cancelTitle}</h2>
                <ChoiceGrid
                  options={CANCEL_REASONS.map((r) => ({
                    value: r,
                    label: t.web.tracking.cancelReasons[r],
                  }))}
                  value={reason}
                  onChange={setReason}
                />
                <p className="text-sm text-muted">{t.web.tracking.cancelPolicy}</p>
                <Button
                  variant="danger"
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
              </>
            )}
          </Card>
        )}
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
