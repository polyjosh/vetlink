'use client';

import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';
import { Card } from './ui';

/** The farmer's VetLink credit (§24.25): balance and recent entries. */
export function WalletCard() {
  const { t, fmt, lang } = useT();
  const { api } = useSession();
  const [w, setW] = useState<Schemas['Wallet'] | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/wallet');
    setW(data ?? null);
  }, [api]);
  useLoad(load);
  const x = t.web.wallet;
  if (!w) return null;
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">{x.title}</h2>
      <p className="text-2xl font-bold">
        {fmt(x.balance, { amount: w.balance.toLocaleString('en-KE') })}
      </p>
      <p className="text-sm text-muted">{x.balanceHint}</p>
      {w.entries.length === 0 ? (
        <p className="text-muted">{x.empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {w.entries.slice(0, 10).map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-1 text-sm">
              <span>
                {x.kinds[e.kind]}
                {e.bookingId !== null && ` · #${e.bookingId}`}
                <span className="text-muted">
                  {' '}
                  · {new Date(e.createdAt).toLocaleDateString(lang)}
                </span>
              </span>
              <span className={e.amount > 0 ? 'font-semibold text-brand-dark' : ''}>
                {e.amount > 0 ? '+' : ''}
                {e.amount.toLocaleString('en-KE')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
