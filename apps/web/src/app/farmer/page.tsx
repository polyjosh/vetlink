'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { TERMINAL_BOOKING_STATUSES } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { Shell } from '@/components/shell';
import { Card, LinkButton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { PersonAvatar } from '@/components/pictures';

/** Farmer home (§8.2): a big Request button, a red Emergency button, the active request. */
export default function FarmerHome() {
  const { t, fmt } = useT();
  const { api, me } = useSession();
  const [active, setActive] = useState<Schemas['FarmerBooking'][]>([]);
  const [recent, setRecent] = useState<Schemas['RecentVet'][]>([]);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/bookings', {
      params: { query: { as: 'farmer', limit: 10 } },
    });
    setActive(
      ((data ?? []) as Schemas['FarmerBooking'][]).filter(
        (b) => !TERMINAL_BOOKING_STATUSES.includes(b.status),
      ),
    );
    const r = await api.GET('/v1/farmers/me/recent-vets');
    setRecent(r.data ?? []);
  }, [api]);
  usePoll(load, 15_000);
  return (
    <Shell
      title={fmt(t.web.farmer.homeTitle, { name: me?.name ? `, ${me.name}` : '' })}
      role="farmer"
      nav={<FarmerNav />}
    >
      <div className="space-y-4">
        <LinkButton href="/farmer/request" className="w-full py-6 text-xl">
          {t.web.farmer.requestVet}
        </LinkButton>
        <LinkButton
          href="/farmer/request?emergency=1"
          variant="danger"
          className="w-full py-6 text-xl"
        >
          {t.web.farmer.emergency}
        </LinkButton>
        <p className="text-sm text-muted">{t.web.farmer.emergencyHint}</p>
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t.web.farmer.activeBooking}</h2>
          {active.length === 0 ? (
            <p className="text-muted">{t.web.farmer.noActive}</p>
          ) : (
            <ul className="space-y-2">
              {active.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/farmer/bookings/${b.id}`}
                    className="flex min-h-touch items-center justify-between rounded-control bg-canvas px-3"
                  >
                    <span>
                      {fmt(t.web.tracking.title, { ref: b.id })}: {t.ussd.species[b.species]}
                    </span>
                    <span className="font-semibold">{t.ussd.statuses[b.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {recent.length > 0 && (
          <Card className="space-y-2">
            <h2 className="text-lg font-bold">{t.web.bookAgain.title}</h2>
            <ul className="space-y-2">
              {recent.map((r) => (
                <li key={r.vetId} className="flex items-center gap-3">
                  <PersonAvatar url={r.photoUrl} name={r.name} size={40} />
                  {r.available ? (
                    <Link
                      href={`/farmer/request?vet=${r.vetId}${r.animalId ? `&animal=${r.animalId}` : ''}`}
                      className="flex-1 font-semibold underline"
                    >
                      {fmt(t.web.bookAgain.button, { vet: r.name ?? '' })}
                    </Link>
                  ) : (
                    <span className="flex-1">
                      {r.name} · <span className="text-muted">{t.web.bookAgain.unavailable}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
