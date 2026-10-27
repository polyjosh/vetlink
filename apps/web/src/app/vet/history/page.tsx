'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { Shell } from '@/components/shell';
import { Card, Spinner, StatusChip } from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function JobHistory() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [rows, setRows] = useState<Schemas['VetJob'][] | null>(null);
  useEffect(() => {
    void api
      .GET('/v1/bookings', { params: { query: { as: 'vet', limit: 50 } } })
      .then(({ data }) => setRows((data ?? []) as Schemas['VetJob'][]));
  }, [api]);
  return (
    <Shell title={t.web.vet.jobHistory} role="vet" nav={<VetNav />}>
      {!rows ? (
        <Spinner label={t.web.common.loading} />
      ) : (
        <Card>
          {rows.length === 0 && <p className="text-muted">{t.web.vet.noJobs}</p>}
          <ul className="divide-y divide-line">
            {rows.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/vet/jobs/${j.id}`}
                  className="flex min-h-touch items-center justify-between py-2"
                >
                  <span>
                    {fmt(t.web.tracking.title, { ref: j.id })} · {t.ussd.species[j.species]} ·{' '}
                    {j.acceptedAt && new Date(j.acceptedAt).toLocaleDateString(lang)}
                  </span>
                  <StatusChip status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
