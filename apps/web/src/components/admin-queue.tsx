'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { Badge, Spinner } from './ui';

type Item = Schemas['ApplicationQueueItem'];
type Tab = 'all' | 'submitted' | 'under_review';

function initials(name: string | null): string {
  return (
    (name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

/**
 * The verification queue (§13, AdminQueue.dc.html): status tabs over the list the API returns
 * (resubmissions first, then oldest), with the SLA age. `selected` highlights the open one.
 */
export function ApplicationQueue({ selected }: { selected?: number }) {
  const { t, fmt } = useT();
  const { api } = useSession();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/vet-applications', { params: { query: {} } });
    setRows(data ?? []);
  }, [api]);
  usePoll(load, 30_000);
  const a = t.web.admin;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'all', label: a.tabAll },
    { value: 'submitted', label: t.web.application.states.submitted },
    { value: 'under_review', label: t.web.application.states.under_review },
  ];
  const shown = (rows ?? []).filter((r) => tab === 'all' || r.status === tab);
  return (
    <div className="space-y-4">
      <div role="group" aria-label={a.statusTabs} className="flex flex-wrap gap-2">
        {tabs.map((x) => {
          const n = (rows ?? []).filter((r) => x.value === 'all' || r.status === x.value).length;
          const on = tab === x.value;
          return (
            <button
              key={x.value}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(x.value)}
              className={`min-h-touch rounded-full px-4 text-small ${on ? 'bg-ink font-bold text-on-primary' : 'border border-border bg-surface font-semibold'}`}
            >
              {rows ? fmt(a.tabCount, { label: x.label, n }) : x.label}
            </button>
          );
        })}
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        {!rows ? (
          <Spinner label={t.web.common.loading} />
        ) : shown.length === 0 ? (
          <p className="p-5 text-ink-muted">{a.queueEmpty}</p>
        ) : (
          <ul className="divide-y divide-divider">
            {shown.map((r) => {
              const on = r.id === selected;
              return (
                <li key={r.id}>
                  <Link
                    href={`/admin/applications/${r.id}`}
                    aria-current={on ? 'page' : undefined}
                    className={`flex min-h-touch items-center gap-3 px-4 py-3.5 ${on ? 'bg-primary-soft' : 'hover:bg-ground'}`}
                  >
                    <span
                      aria-hidden
                      className={`flex size-10 shrink-0 items-center justify-center rounded-md text-small font-extrabold ${on ? 'bg-primary text-on-primary' : 'bg-primary-soft text-primary'}`}
                    >
                      {initials(r.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block ${on ? 'font-extrabold' : 'font-bold'}`}>
                        {r.name ?? '-'} <span className="text-ink-muted">· {r.reference}</span>
                      </span>
                      <span className="block text-small text-ink-muted">
                        {r.vetType === 'vet'
                          ? t.web.onboarding.vetTypeVet
                          : t.web.onboarding.vetTypeParavet}
                        {r.county ? ` · ${r.county}` : ''}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.resubmission && <Badge>{a.resubmission}</Badge>}
                        {r.assisted && <Badge>{a.assisted}</Badge>}
                        {r.claimedBy && <Badge tone="success">{a.claimed}</Badge>}
                      </span>
                    </span>
                    <span
                      className={`text-small ${r.slaBreached ? 'font-bold text-danger' : 'text-ink-muted'}`}
                    >
                      {r.slaBreached ? a.slaBreached : fmt(a.age, { hours: r.ageHours })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
