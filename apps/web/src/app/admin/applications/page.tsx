'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { AdminNav } from '@/components/admin-nav';
import { Shell } from '@/components/shell';
import { Badge, Card, Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/lib/poll';
import { useSession } from '@/lib/session';

/** Verification queue (§13): resubmissions first, then oldest, with the SLA flag. */
export default function Queue() {
  const { t, fmt } = useT();
  const { api } = useSession();
  const [rows, setRows] = useState<Schemas['ApplicationQueueItem'][] | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/admin/vet-applications', { params: { query: {} } });
    setRows(data ?? []);
  }, [api]);
  usePoll(load, 30_000);
  const a = t.web.admin;
  return (
    <Shell title={a.queue} role="admin" nav={<AdminNav />}>
      {!rows ? (
        <Spinner label={t.web.common.loading} />
      ) : (
        <Card>
          {rows.length === 0 && <p className="text-muted">{a.queueEmpty}</p>}
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/applications/${r.id}`}
                  className="flex min-h-touch flex-wrap items-center gap-2 py-2"
                >
                  <strong>{r.reference}</strong>
                  <span>{r.name ?? '-'}</span>
                  <span className="text-muted">
                    {r.vetType === 'vet'
                      ? t.web.onboarding.vetTypeVet
                      : t.web.onboarding.vetTypeParavet}{' '}
                    · {r.ward ?? ''} {r.county ?? ''}
                  </span>
                  <span className="flex-1" />
                  {r.resubmission && <Badge>{a.resubmission}</Badge>}
                  {r.assisted && <Badge>{a.assisted}</Badge>}
                  {r.claimedBy && <Badge tone="success">{a.claimed}</Badge>}
                  <Badge tone={r.slaBreached ? 'danger' : 'warning'}>
                    {r.slaBreached ? a.slaBreached : fmt(a.age, { hours: r.ageHours })}
                  </Badge>
                  <span>{t.web.application.states[r.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
