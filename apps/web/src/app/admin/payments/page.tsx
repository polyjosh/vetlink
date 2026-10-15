'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import { Button, Card, ErrorBox, Input, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** Payments (§13): recent payments and the manual refunds still to send. */
export default function AdminPayments() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const { run, dialog } = useStepUp();
  const [rows, setRows] = useState<Schemas['AdminPayment'][] | null>(null);
  const [refunds, setRefunds] = useState<Schemas['AdminPayment'][]>([]);
  const [receipts, setReceipts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const a = t.web.admin;
  const load = useCallback(async () => {
    const [all, pend] = await Promise.all([
      api.GET('/v1/admin/payments', { params: { query: { limit: 100 } } }),
      api.GET('/v1/admin/payments', {
        params: { query: { type: 'refund', status: 'pending', limit: 100 } },
      }),
    ]);
    setRows(all.data ?? []);
    setRefunds(pend.data ?? []);
  }, [api]);
  usePoll(load, 30_000);
  return (
    <Shell title={a.payments} role="admin" nav={<AdminNav />}>
      {dialog}
      <div className="space-y-4">
        <Card className="space-y-2">
          <h2 className="font-bold">{a.pendingRefunds}</h2>
          {refunds.length === 0 && <p className="text-muted">{t.web.common.none}</p>}
          {refunds.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <span>
                {fmt(t.web.tracking.title, { ref: p.bookingId })} ·{' '}
                {fmt(t.web.common.kes, { amount: p.amount })}
              </span>
              <Input
                className="max-w-48"
                placeholder={a.receipt}
                value={receipts[p.id] ?? ''}
                onChange={(e) => setReceipts({ ...receipts, [p.id]: e.target.value.toUpperCase() })}
              />
              <Button
                disabled={!/^[A-Z0-9]{8,20}$/.test(receipts[p.id] ?? '')}
                onClick={async () => {
                  setError(
                    await run(() =>
                      api.POST('/v1/admin/payments/{id}/refund-complete', {
                        params: { path: { id: p.id } },
                        body: { mpesaReceipt: receipts[p.id] ?? '' },
                      }),
                    ),
                  );
                  await load();
                }}
              >
                {a.markRefunded}
              </Button>
            </div>
          ))}
        </Card>
        <ErrorBox message={error} />
        {!rows ? (
          <Spinner label={t.web.common.loading} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1">
                      <Link className="underline" href={`/admin/bookings/${p.bookingId}`}>
                        {p.bookingId}
                      </Link>
                    </td>
                    <td>{p.type}</td>
                    <td>{fmt(t.web.common.kes, { amount: p.amount })}</td>
                    <td>{p.status}</td>
                    <td>{p.receipt ?? ''}</td>
                    <td>{new Date(p.createdAt).toLocaleString(lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Shell>
  );
}
