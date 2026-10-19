'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { FarmerNav } from '@/components/farmer-nav';
import { Shell } from '@/components/shell';
import { Card, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/components/pictures';

export default function BookingHistory() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [rows, setRows] = useState<Schemas['FarmerBooking'][] | null>(null);
  useEffect(() => {
    void api
      .GET('/v1/bookings', { params: { query: { as: 'farmer', limit: 50 } } })
      .then(({ data }) => setRows((data ?? []) as Schemas['FarmerBooking'][]));
  }, [api]);
  return (
    <Shell title={t.web.farmer.history} role="farmer" nav={<FarmerNav />}>
      {!rows ? (
        <Spinner label={t.web.common.loading} />
      ) : (
        <Card>
          {rows.length === 0 && <EmptyState kind="noBookings" text={t.web.farmer.noActive} />}
          <ul className="divide-y divide-line">
            {rows.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/farmer/bookings/${b.id}`}
                  className="flex min-h-touch items-center justify-between py-2"
                >
                  <span>
                    {fmt(t.web.tracking.title, { ref: b.id })} · {t.ussd.species[b.species]} ·{' '}
                    {new Date(b.createdAt).toLocaleDateString(lang)}
                  </span>
                  <span className="font-semibold">{t.ussd.statuses[b.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
