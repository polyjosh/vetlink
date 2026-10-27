'use client';

import { useCallback, useState } from 'react';
import { RATING_TAGS } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { EmptyState } from '@/components/pictures';
import { Shell } from '@/components/shell';
import { Card, Spinner } from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** The vet's ratings (§24.4): summary, what farmers said, the latest ones. No farmer names. */
export default function VetRatings() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [data, setData] = useState<Schemas['VetRatings'] | null>(null);
  const load = useCallback(async () => {
    const { data: d } = await api.GET('/v1/vets/me/ratings');
    setData(d ?? null);
  }, [api]);
  useLoad(load);
  const r = t.web.ratings;
  return (
    <Shell title={r.title} role="vet" nav={<VetNav />}>
      {!data ? (
        <Spinner label={t.web.common.loading} />
      ) : data.count === 0 ? (
        <Card>
          <EmptyState kind="noRatings" text={r.empty} />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="space-y-2">
            <p className="text-3xl font-bold">★ {data.average?.toFixed(1)}</p>
            <p className="text-muted">{fmt(r.count, { n: data.count })}</p>
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <div key={n} className="flex items-center gap-2">
                <span className="w-6">{n}★</span>
                <div className="h-3 flex-1 rounded-full bg-canvas">
                  <div
                    className="h-3 rounded-full bg-brand"
                    style={{ width: `${(data.distribution[n] / data.count) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm">{data.distribution[n]}</span>
              </div>
            ))}
          </Card>
          <Card className="space-y-2">
            <h2 className="font-bold">{r.tagsTitle}</h2>
            <ul className="flex flex-wrap gap-2">
              {RATING_TAGS.filter((tag) => (data.tagCounts[tag] ?? 0) > 0).map((tag) => (
                <li key={tag} className="rounded-full border border-line px-3 py-1">
                  {r.tags[tag]} · {data.tagCounts[tag]}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <ul className="divide-y divide-line">
              {data.items.map((i) => (
                <li key={i.bookingId} className="space-y-1 py-2">
                  <p>
                    <strong>{'★'.repeat(i.stars)}</strong>{' '}
                    <span className="text-muted">
                      {fmt(r.job, { ref: i.bookingId })} · {t.ussd.species[i.species]} ·{' '}
                      {new Date(i.createdAt).toLocaleDateString(lang)}
                    </span>
                  </p>
                  {i.tags.length > 0 && (
                    <p className="text-sm">{i.tags.map((tag) => r.tags[tag]).join(' · ')}</p>
                  )}
                  {i.comment && <p className="italic">“{i.comment}”</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </Shell>
  );
}
