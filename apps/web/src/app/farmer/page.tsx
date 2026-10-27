'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { TERMINAL_BOOKING_STATUSES, comingUp, dayBox, speciesCounts } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { PersonAvatar } from '@/components/pictures';
import { Shell } from '@/components/shell';
import { Card, Icon, LinkButton, PersonRow, StatusChip } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useLoad, usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

/**
 * Farmer dashboard (§8.2, WebFarmer.dc.html): the Request a vet hero beside the active request,
 * recent visits, and a sidebar with animal counts and what is coming up.
 */
export default function FarmerHome() {
  const { t, alt, fmt, lang } = useT();
  const f = t.web.farmer;
  const { api, me } = useSession();
  const [rows, setRows] = useState<Schemas['FarmerBooking'][]>([]);
  const [recent, setRecent] = useState<Schemas['RecentVet'][]>([]);
  const [animals, setAnimals] = useState<Schemas['Animal'][]>([]);
  const [ward, setWard] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/bookings', {
      params: { query: { as: 'farmer', limit: 10 } },
    });
    setRows((data ?? []) as Schemas['FarmerBooking'][]);
    const r = await api.GET('/v1/farmers/me/recent-vets');
    setRecent(r.data ?? []);
  }, [api]);
  usePoll(load, 15_000);
  const loadOnce = useCallback(async () => {
    const [a, p] = await Promise.all([api.GET('/v1/animals'), api.GET('/v1/farmers/me')]);
    setAnimals(a.data ?? []);
    setWard(p.data?.ward?.ward ?? null);
  }, [api]);
  useLoad(loadOnce);

  const active = rows.filter((b) => !TERMINAL_BOOKING_STATUSES.includes(b.status));
  const upcoming = comingUp(rows).slice(0, 4);
  const counts = speciesCounts(animals);
  const name = me?.displayName ?? me?.name;
  const subtitle = [ward, animals.length ? fmt(f.animalsOnRecord, { n: animals.length }) : null]
    .filter(Boolean)
    .join(' · ');
  const what = (b: Schemas['FarmerBooking']) =>
    fmt(f.activeLine, {
      animal: t.ussd.species[b.species],
      problem: t.ussd.problems[b.problemType].toLowerCase(),
    });

  return (
    <Shell
      title={fmt(f.homeTitle, { name: name ? `, ${name}` : '' })}
      subtitle={subtitle || undefined}
      role="farmer"
      nav={<FarmerNav />}
      wide
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-6">
          <section className="flex min-w-0 flex-[1_1_420px] flex-col gap-5 rounded-xl bg-primary p-6 text-on-primary sm:p-7">
            <div>
              <h2 className="text-title font-extrabold">{f.heroTitle}</h2>
              <p className="mt-2 max-w-md text-on-primary-muted">{f.heroHintWeb}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/farmer/request" variant="accent" size="lg" icon="plus">
                {f.requestVet}
              </LinkButton>
              <Link
                href="/farmer/request"
                className="inline-flex min-h-button-lg items-center rounded-md border-strong border-on-primary/40 px-5 font-bold text-on-primary hover:bg-on-primary/10"
              >
                {f.routineVisit}
              </Link>
            </div>
          </section>

          {active.length > 0 ? (
            <section className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
              {active.map((b) => {
                const vet = b.vet ?? null;
                return (
                  <Card key={b.id} className="flex flex-1 flex-col gap-4 !rounded-xl">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-heading font-extrabold">{f.activeBooking}</h2>
                      <StatusChip status={b.status} />
                    </div>
                    {vet || b.requestedVet ? (
                      <PersonRow
                        name={vet?.name ?? b.requestedVet?.name ?? ''}
                        photoUrl={vet?.photoUrl ?? b.requestedVet?.photoUrl}
                        verified
                        meta={what(b)}
                      />
                    ) : (
                      <p className="text-ink-muted">{what(b)}</p>
                    )}
                    <div className="mt-auto flex gap-3">
                      <LinkButton href={`/farmer/bookings/${b.id}`} className="flex-1">
                        {f.track}
                      </LinkButton>
                      {vet?.phone && (
                        <a
                          href={`tel:+${vet.phone}`}
                          className="inline-flex min-h-button-md flex-1 items-center justify-center rounded-md border-strong border-border font-bold hover:border-primary"
                        >
                          {t.web.tracking.callVet}
                        </a>
                      )}
                    </div>
                  </Card>
                );
              })}
            </section>
          ) : (
            <Card className="flex min-w-0 flex-[1_1_340px] flex-col justify-center !rounded-xl">
              <h2 className="text-heading font-extrabold">{f.activeBooking}</h2>
              <p className="mt-1 text-ink-muted">{f.noActive}</p>
            </Card>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <section className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
              <h2 className="text-heading font-extrabold">{f.recentVisits}</h2>
              <Link href="/farmer/bookings" className="text-small font-bold text-primary">
                {f.allBookings}
              </Link>
            </div>
            {rows.length === 0 ? (
              <p className="px-6 pb-6 text-ink-muted">{t.web.empty.noBookings}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-y border-divider bg-ground text-label tracking-wide text-ink-muted uppercase">
                      <th className="px-6 py-3">{t.web.common.date}</th>
                      <th className="px-3 py-3">{f.colAnimal}</th>
                      <th className="px-3 py-3">{f.colReason}</th>
                      <th className="px-3 py-3">{f.colVet}</th>
                      <th className="px-6 py-3">{t.web.common.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id} className="border-b border-divider last:border-0">
                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <Link href={`/farmer/bookings/${b.id}`} className="font-semibold">
                            {new Date(b.createdAt).toLocaleDateString(lang, {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </Link>
                        </td>
                        <td className="px-3 py-3.5">{t.ussd.species[b.species]}</td>
                        <td className="px-3 py-3.5">{t.ussd.problems[b.problemType]}</td>
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          {b.vet?.name ?? b.requestedVet?.name ?? '–'}
                        </td>
                        <td className="px-6 py-3.5">
                          <StatusChip status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
            <Card className="!rounded-xl">
              <h2 className="mb-3 text-heading font-extrabold">{f.myAnimals}</h2>
              {counts.length === 0 ? (
                <p className="text-ink-muted">{t.web.animals.empty}</p>
              ) : (
                <ul className="divide-y divide-divider">
                  {counts.map((c) => (
                    <li key={c.species} className="flex items-center justify-between py-2.5">
                      <span>
                        <span className="font-bold">{t.web.ui.speciesPlural[c.species]}</span>
                        <span className="text-ink-muted">
                          {' '}
                          · {alt.web.ui.speciesPlural[c.species]}
                        </span>
                      </span>
                      <span className="text-heading font-extrabold">{c.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <LinkButton
                href="/farmer/animals"
                variant="secondary"
                icon="plus"
                className="mt-4 w-full"
              >
                {t.web.animals.add}
              </LinkButton>
            </Card>

            <Card className="!rounded-xl">
              <h2 className="mb-3 text-heading font-extrabold">{f.comingUp}</h2>
              {upcoming.length === 0 ? (
                <p className="text-ink-muted">{f.comingUpEmpty}</p>
              ) : (
                <ul className="divide-y divide-divider">
                  {upcoming.map((u) => {
                    const box = dayBox(u.at, lang);
                    const animal = t.ussd.species[u.species];
                    return (
                      <li key={u.key}>
                        <Link
                          href={`/farmer/bookings/${u.bookingId}`}
                          className="flex items-center gap-3 py-3"
                        >
                          <span className="w-11 shrink-0 text-center">
                            <span className="block text-label text-warning">{box.month}</span>
                            <span className="block text-heading font-extrabold">{box.day}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold">
                              {u.kind === 'visit'
                                ? fmt(f.visitItem, {
                                    problem: t.ussd.problems[u.problemType],
                                    animal,
                                  })
                                : fmt(f.followUpItem, { animal })}
                            </span>
                            <span className="block text-small text-ink-muted">
                              {u.vetName
                                ? fmt(f.withVet, { vet: u.vetName })
                                : u.kind === 'visit'
                                  ? f.visitHint
                                  : f.followUpHint}
                            </span>
                          </span>
                          <Icon name="chevronRight" className="text-ink-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {recent.length > 0 && (
              <Card className="space-y-3 !rounded-xl">
                <h2 className="text-heading font-extrabold">{t.web.bookAgain.title}</h2>
                <ul className="space-y-2">
                  {recent.map((r) => (
                    <li key={r.vetId} className="flex items-center gap-3">
                      <PersonAvatar url={r.photoUrl} name={r.name} size={40} />
                      {r.available ? (
                        <Link
                          href={`/farmer/request?vet=${r.vetId}${r.animalId ? `&animal=${r.animalId}` : ''}`}
                          className="flex min-h-touch flex-1 items-center font-semibold text-primary"
                        >
                          {fmt(t.web.bookAgain.button, { vet: r.name ?? '' })}
                        </Link>
                      ) : (
                        <span className="flex-1">
                          {r.name} ·{' '}
                          <span className="text-ink-muted">{t.web.bookAgain.unavailable}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </Shell>
  );
}
