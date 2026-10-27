'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { TERMINAL_BOOKING_STATUSES, eatDateOf } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { Countdown } from '@/components/countdown';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, ErrorBox, Icon, Notice, StatusChip } from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/components/pictures';
import { PriceLines } from '@/components/prices';
import { FollowUpList } from '@/components/follow-ups';
import { PhotoStrip } from '@/components/photo-strip';
import { AppointmentLine } from '@/components/when-picker';

/** Vet home (§8.3): online toggle, live offers with countdown, active jobs. */
export default function VetHome() {
  const { t, fmt, lang } = useT();
  const { api, me } = useSession();
  const [profile, setProfile] = useState<Schemas['VetProfile'] | null>(null);
  const [offers, setOffers] = useState<Schemas['Offer'][]>([]);
  const [jobs, setJobs] = useState<Schemas['VetJob'][]>([]);
  const [jobsToday, setJobsToday] = useState(0);
  const [followUps, setFollowUps] = useState<Schemas['FollowUp'][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approved = me?.vet?.verificationStatus === 'approved';

  const load = useCallback(async () => {
    const [p, o, j] = await Promise.all([
      api.GET('/v1/vets/me'),
      api.GET('/v1/vets/me/offers'),
      api.GET('/v1/bookings', { params: { query: { as: 'vet', limit: 20 } } }),
    ]);
    setProfile(p.data ?? null);
    setOffers(o.data ?? []);
    const today = eatDateOf(new Date());
    setJobsToday(
      ((j.data ?? []) as Schemas['VetJob'][]).filter(
        (b) => b.acceptedAt && eatDateOf(new Date(b.acceptedAt)) === today,
      ).length,
    );
    setJobs(
      ((j.data ?? []) as Schemas['VetJob'][]).filter(
        (b) => !TERMINAL_BOOKING_STATUSES.includes(b.status),
      ),
    );
  }, [api]);
  usePoll(load, 5_000);
  // Follow-ups change slowly: read them once a minute, not with the offers (§24.4).
  const loadFollowUps = useCallback(async () => {
    const { data } = await api.GET('/v1/vets/me/follow-ups');
    setFollowUps(data ?? []);
  }, [api]);
  usePoll(loadFollowUps, 60_000);

  // §24.10: booked visits the vet has not set off for yet, soonest first; the rest is today's work.
  const upcoming = jobs
    .filter((j) => j.scheduledFor && j.status === 'matched')
    .sort((x, y) => (x.scheduledFor ?? '').localeCompare(y.scheduledFor ?? ''));
  const current = jobs.filter((j) => !upcoming.includes(j));

  const act = async (fn: () => Promise<{ error?: unknown }>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(errorText(lang, e as { code: string; message_key: string }));
    await load();
  };

  const online = profile?.isAvailable ?? false;
  return (
    <Shell title={t.web.vet.homeTitle} role="vet" nav={<VetNav />}>
      <div className="space-y-4">
        <section className="rounded-xl bg-ink px-5 pt-5 pb-20 text-on-primary">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {me?.name && <p className="text-small text-ink-inverse-muted">{me.name}</p>}
              <h2 className="text-title font-extrabold">{t.web.ui.nav.jobs}</h2>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={online}
              aria-label={t.web.vet.availability}
              disabled={!approved || busy || !profile}
              onClick={() =>
                void act(() =>
                  api.PATCH('/v1/vets/me/availability', { body: { isAvailable: !online } }),
                )
              }
              className="flex min-h-touch items-center gap-2.5 rounded-full bg-on-primary/10 pr-2 pl-3.5 text-small font-bold disabled:opacity-50"
            >
              <span
                aria-hidden
                className={`size-2.5 rounded-full ${online ? 'bg-online' : 'bg-ink-muted'}`}
              />
              <span data-testid="online-state">
                {online ? t.web.vet.online : t.web.vet.offline}
              </span>
              <span
                aria-hidden
                className={`relative inline-block h-7 w-12 rounded-full ${online ? 'bg-online' : 'bg-ink-muted'}`}
              >
                <span
                  className={`absolute top-1 size-5 rounded-full bg-surface transition-all ${online ? 'right-1' : 'left-1'}`}
                />
              </span>
            </button>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            {[
              { n: String(jobsToday), label: t.web.vet.jobsToday },
              {
                n: profile?.rating != null ? profile.rating.toFixed(1) : '–',
                label: t.web.vet.ratingStat,
              },
              {
                n: profile ? fmt(t.web.vet.radiusKm, { km: profile.serviceRadiusKm }) : '–',
                label: t.web.vet.radiusStat,
              },
            ].map((x) => (
              <div key={x.label} className="flex flex-col-reverse">
                <dt className="text-small text-ink-inverse-muted">{x.label}</dt>
                <dd className="text-title font-extrabold">{x.n}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="relative -mt-16 space-y-3 px-2 sm:px-4">
          {offers.length === 0 && (
            <Card raised>
              <EmptyState kind="noOffers" text={t.web.vet.noOffers} />
            </Card>
          )}
          {offers.map((o) => (
            <article
              key={o.offerId}
              className="overflow-hidden rounded-xl bg-surface shadow-overlay"
              data-testid="offer"
            >
              <div className="flex items-center justify-between gap-3 bg-accent px-4 py-3 text-ink">
                <span className="text-small font-extrabold tracking-wide uppercase">
                  {[t.web.vet.newRequest, o.isEmergency ? t.web.request.urgent : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="flex items-center gap-1.5 font-extrabold">
                  <Icon name="clock" size={18} />
                  <Countdown until={o.expiresAt} plain />
                </span>
              </div>
              <div className="space-y-3.5 p-4 sm:p-5">
                {o.kind === 'direct' && <Badge tone="success">{t.web.choose.farmerChoseYou}</Badge>}
                <h3 className="text-title tracking-tight">
                  {t.ussd.species[o.species]} · {t.ussd.problems[o.problemType]}
                </h3>
                <p className="flex items-center gap-2">
                  <Icon name="mapPin" size={20} className="text-ink-muted" />
                  {o.ward.ward} ({o.ward.subCounty})
                </p>
                <AppointmentLine scheduledFor={o.scheduledFor} part={o.scheduledPart} />
                <PhotoStrip urls={o.photos} />
                <div className="rounded-md bg-ground p-3">
                  {o.price ? (
                    <PriceLines price={o.price} forVet />
                  ) : (
                    <p>{fmt(t.web.common.kes, { amount: o.feeQuoted })}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2.5">
                  <Button
                    size="xl"
                    icon="check"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api.POST('/v1/bookings/{id}/offers/{offerId}/accept', {
                          params: { path: { id: o.bookingId, offerId: o.offerId } },
                        }),
                      )
                    }
                  >
                    {t.web.vet.accept}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api.POST('/v1/bookings/{id}/offers/{offerId}/decline', {
                          params: { path: { id: o.bookingId, offerId: o.offerId } },
                        }),
                      )
                    }
                  >
                    {t.web.vet.decline}
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {offers.length > 0 && (
            <p className="text-center text-small text-ink-muted">{t.web.vet.smsHint}</p>
          )}
        </div>

        <ErrorBox message={error} />
        {!approved && <Notice tone="warning">{t.web.vet.notApproved}</Notice>}
        {approved && profile && profile.practiceMissing.length > 0 && (
          <Notice tone="warning">
            {t.errors.practice_incomplete}{' '}
            <Link href="/vet/profile" className="font-semibold underline">
              {t.web.vetProfile.title}
            </Link>
          </Notice>
        )}
        {profile && approved && (
          <Card className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-small text-ink-muted">
              {online ? t.web.vet.onlineHint : t.web.vet.shareLocationHint}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                if (profile.shareLiveLocation) void act(() => api.DELETE('/v1/vets/me/location'));
                else
                  navigator.geolocation.getCurrentPosition(
                    (p) =>
                      void act(() =>
                        api.PUT('/v1/vets/me/location', {
                          body: { lat: p.coords.latitude, lng: p.coords.longitude },
                        }),
                      ),
                  );
              }}
            >
              {profile.shareLiveLocation ? t.web.vet.stopSharing : t.web.vet.shareLocation}
            </Button>
          </Card>
        )}

        {followUps.some((f) => !f.rebookedBookingId) && (
          <Card className="space-y-2 border-warning">
            <h2 className="text-lg font-bold">{t.web.followUps.title}</h2>
            <FollowUpList items={followUps.filter((f) => !f.rebookedBookingId).slice(0, 3)} />
            <Link href="/vet/follow-ups" className="text-sm underline">
              {t.web.followUps.seeAll}
            </Link>
          </Card>
        )}

        {upcoming.length > 0 && (
          <Card className="space-y-2">
            <h2 className="text-lg font-bold">{t.web.schedule.upcomingTitle}</h2>
            <ul className="space-y-2">
              {upcoming.map((j) => (
                <li key={j.id}>
                  <Link
                    href={`/vet/jobs/${j.id}`}
                    className="block rounded-control bg-canvas px-3 py-2"
                  >
                    <AppointmentLine scheduledFor={j.scheduledFor} part={j.scheduledPart} />
                    <span>
                      {fmt(t.web.tracking.title, { ref: j.id })}: {t.ussd.species[j.species]} ·{' '}
                      {j.ward.ward}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="mb-2 text-lg font-bold">{t.web.vet.activeJobs}</h2>
          {current.length === 0 && <p className="text-muted">{t.web.vet.noJobs}</p>}
          <ul className="space-y-2">
            {current.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/vet/jobs/${j.id}`}
                  className="flex min-h-touch items-center justify-between gap-3 rounded-md bg-ground px-3 py-2"
                >
                  <span>
                    {fmt(t.web.tracking.title, { ref: j.id })}: {t.ussd.species[j.species]} ·{' '}
                    {j.ward.ward}
                  </span>
                  <StatusChip status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {!approved && (
          <Notice tone="warning">
            <Link href="/vet/status" className="underline">
              {t.web.application.statusTitle}
            </Link>
          </Notice>
        )}
      </div>
    </Shell>
  );
}
