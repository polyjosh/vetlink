'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { Shell } from '@/components/shell';
import { Card, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function AnimalHistory() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [h, setH] = useState<Schemas['AnimalHistory'] | null>(null);
  useEffect(() => {
    void api
      .GET('/v1/animals/{id}/history', { params: { path: { id } } })
      .then(({ data }) => setH(data ?? null));
  }, [api, id]);
  if (!h) return <Spinner label={t.web.common.loading} />;
  return (
    <Shell
      title={h.animal.nameOrTag ?? t.ussd.species[h.animal.species]}
      role="farmer"
      nav={<FarmerNav />}
    >
      <Card>
        <h2 className="mb-2 font-bold">{t.web.animals.historyTitle}</h2>
        {h.visits.length === 0 && <p className="text-muted">{t.web.animals.noVisits}</p>}
        <ul className="divide-y divide-line">
          {h.visits.map((v) => (
            <li key={v.bookingId} className="py-2">
              <Link href={`/farmer/bookings/${v.bookingId}`} className="font-semibold underline">
                {fmt(t.web.tracking.title, { ref: v.bookingId })}
              </Link>{' '}
              · {new Date(v.createdAt).toLocaleDateString(lang)} · {t.ussd.problems[v.problemType]}{' '}
              · {t.ussd.statuses[v.status]}
              {v.treatment?.diagnosis && (
                <p className="text-muted">
                  {t.web.tracking.diagnosis}: {v.treatment.diagnosis}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
