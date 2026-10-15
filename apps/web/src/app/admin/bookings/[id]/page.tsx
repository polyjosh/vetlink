'use client';

import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { useStepUp } from '@/components/step-up';
import { Button, Card, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { errorText } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

export default function AdminBooking() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const { run, dialog } = useStepUp();
  const [b, setB] = useState<Schemas['AdminBooking'] | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const a = t.web.admin;
  const load = useCallback(async () => {
    const { data, error: e } = await api.GET('/v1/admin/bookings/{id}', {
      params: { path: { id: Number(id) } },
    });
    if (e) setError(errorText(lang, e));
    setB(data ?? null);
  }, [api, id, lang]);
  useLoad(load);
  if (!b)
    return (
      <Shell title={fmt(a.booking, { ref: id })} role="admin" nav={<AdminNav />}>
        {error ? <ErrorBox message={error} /> : <Spinner label={t.web.common.loading} />}
      </Shell>
    );
  return (
    <Shell title={fmt(a.booking, { ref: b.id })} role="admin" nav={<AdminNav />}>
      {dialog}
      <div className="space-y-4">
        <Card className="space-y-1">
          <p className="text-xl font-bold">{t.ussd.statuses[b.status]}</p>
          <p>
            {t.ussd.species[b.species]}, {t.ussd.problems[b.problemType]} · {b.ward.ward},{' '}
            {b.ward.county} · {b.sourceChannel}
          </p>
          {b.note && <p className="italic">“{b.note}”</p>}
          <p>
            {t.web.request.fee}: {fmt(t.web.common.kes, { amount: b.feeQuoted })} ·{' '}
            {t.web.tracking.depositStatus[b.deposit.status]} {b.deposit.receipt ?? ''}
          </p>
          <p>
            {t.web.vet.farmer}: {b.farmer?.name ?? '-'} {b.farmer?.phone ?? ''}
          </p>
          {b.vet && (
            <p>
              {t.web.roles.vet}: {b.vet.name ?? '-'} {b.vet.phone ?? ''}
            </p>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">{t.web.tracking.timeline}</h2>
          <ol>
            {b.timeline.map((e) => (
              <li key={`${e.event}-${e.at}`}>
                {e.event} → {t.ussd.statuses[e.status]} · {new Date(e.at).toLocaleString(lang)}
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">{a.offers}</h2>
          <table className="w-full text-sm">
            <tbody>
              {b.offers.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="py-1">#{o.wave}</td>
                  <td className="break-all">{o.vetId.slice(0, 8)}</td>
                  <td>{o.channel}</td>
                  <td>{new Date(o.sentAt).toLocaleTimeString(lang)}</td>
                  <td>{o.response ?? '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {b.actions.includes('admin_cancelled') && (
          <Card className="space-y-2">
            <Field label={a.cancelReason}>
              <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              onClick={async () => {
                setError(
                  await run(() =>
                    api.POST('/v1/admin/bookings/{id}/cancel', {
                      params: { path: { id: b.id } },
                      body: { reason },
                    }),
                  ),
                );
                await load();
              }}
            >
              {a.cancelBooking}
            </Button>
          </Card>
        )}
        <ErrorBox message={error} />
      </div>
    </Shell>
  );
}
