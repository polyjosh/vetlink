'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { BOOKING_STATUSES, type BookingStatus } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { Badge, Card, Select, Spinner, StatusChip } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

export default function AdminBookings() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [rows, setRows] = useState<Schemas['FarmerBooking'][] | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/bookings', {
      params: {
        query: {
          limit: 100,
          ...(status && { status }),
          ...(overdue && { overdue: 'true' as const }),
        },
      },
    });
    setRows(data ?? []);
  }, [api, status, overdue]);
  usePoll(load, 30_000);
  return (
    <Shell title={t.web.admin.bookings} role="admin" nav={<AdminNav />}>
      <div className="space-y-4">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as BookingStatus | '')}
          aria-label={t.web.common.status}
        >
          <option value="">{t.web.common.status}</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.ussd.statuses[s]}
            </option>
          ))}
        </Select>
        <label className="flex min-h-touch items-center gap-2">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {t.web.schedule.overdue}
        </label>
        {!rows ? (
          <Spinner label={t.web.common.loading} />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {rows.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="flex min-h-touch flex-wrap items-center gap-2 py-2"
                  >
                    <strong>{fmt(t.web.tracking.title, { ref: b.id })}</strong>
                    {b.isEmergency && <Badge tone="danger">{t.web.request.emergencyBadge}</Badge>}
                    {b.overdue && <Badge tone="warning">{t.web.schedule.overdue}</Badge>}
                    <span>
                      {t.ussd.species[b.species]} · {b.ward.ward} ·{' '}
                      {new Date(b.createdAt).toLocaleString(lang)}
                    </span>
                    <span className="flex-1" />
                    <StatusChip status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
