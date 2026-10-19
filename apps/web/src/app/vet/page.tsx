'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { TERMINAL_BOOKING_STATUSES } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { Countdown } from '@/components/countdown';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, ErrorBox, Notice } from '@/components/ui';
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
        <Card className={`space-y-2 ${online ? 'border-brand' : ''}`}>
          <p className="text-xl font-bold" data-testid="online-state">
            {online ? t.web.vet.online : t.web.vet.offline}
          </p>
          <p className="text-sm text-muted">
            {approved ? t.web.vet.onlineHint : t.web.vet.notApproved}
          </p>
          {approved && profile && profile.practiceMissing.length > 0 && (
            <Notice tone="warning">
              {t.errors.practice_incomplete}{' '}
              <Link href="/vet/profile" className="font-semibold underline">
                {t.web.vetProfile.title}
              </Link>
            </Notice>
          )}
          <Button
            variant={online ? 'secondary' : 'primary'}
            disabled={!approved || busy || !profile}
            onClick={() =>
              void act(() =>
                api.PATCH('/v1/vets/me/availability', { body: { isAvailable: !online } }),
              )
            }
          >
            {online ? t.web.vet.goOffline : t.web.vet.goOnline}
          </Button>
          {profile && approved && (
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
          )}
          {profile && !profile.shareLiveLocation && approved && (
            <p className="text-sm text-muted">{t.web.vet.shareLocationHint}</p>
          )}
        </Card>

        <ErrorBox message={error} />

        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t.web.vet.offers}</h2>
          {offers.length === 0 && <EmptyState kind="noOffers" text={t.web.vet.noOffers} />}
          {offers.map((o) => (
            <div
              key={o.offerId}
              className="space-y-2 rounded-control border border-line p-3"
              data-testid="offer"
            >
              <div className="flex flex-wrap items-center gap-2">
                {o.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
                {o.kind === 'direct' && <Badge tone="success">{t.web.choose.farmerChoseYou}</Badge>}
                <strong>
                  {t.ussd.species[o.species]}, {t.ussd.problems[o.problemType]}
                </strong>
                <Countdown until={o.expiresAt} />
              </div>
              <p>
                {o.ward.ward} ({o.ward.subCounty})
              </p>
              <AppointmentLine scheduledFor={o.scheduledFor} part={o.scheduledPart} />
              <PhotoStrip urls={o.photos} />
              {o.price ? (
                <PriceLines price={o.price} forVet />
              ) : (
                <p>{fmt(t.web.common.kes, { amount: o.feeQuoted })}</p>
              )}
              <div className="flex gap-2">
                <Button
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
          ))}
        </Card>

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
                  className="flex min-h-touch items-center justify-between rounded-control bg-canvas px-3"
                >
                  <span>
                    {fmt(t.web.tracking.title, { ref: j.id })}: {t.ussd.species[j.species]} ·{' '}
                    {j.ward.ward}
                  </span>
                  <span className="font-semibold">{t.ussd.statuses[j.status]}</span>
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
