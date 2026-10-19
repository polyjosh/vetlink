'use client';

import Link from 'next/link';
import type { Schemas } from '@vetlink/api-client';
import { useT } from '@/lib/i18n';

/** Upcoming follow-ups (§24.4); contact details appear only within 7 days of the date. */
export function FollowUpList({ items }: { items: Schemas['FollowUp'][] }) {
  const { t, fmt, lang } = useT();
  const f = t.web.followUps;
  const when = (x: Schemas['FollowUp']) =>
    x.daysAway === 0
      ? f.today
      : x.daysAway === 1
        ? f.tomorrow
        : new Date(x.followUpDate).toLocaleDateString(lang);
  return (
    <ul className="divide-y divide-line">
      {items.map((x) => (
        <li key={x.treatmentId} className="space-y-1 py-2">
          <p>
            <strong>{when(x)}</strong> · {t.ussd.species[x.species]} · {x.ward}
          </p>
          <p className="text-sm text-muted">
            <Link href={`/vet/jobs/${x.bookingId}`} className="underline">
              {fmt(f.job, { ref: x.bookingId })}
            </Link>
            {x.diagnosis && ` · ${x.diagnosis}`}
          </p>
          {x.farmer && (
            <p>
              {x.farmer.name ?? '-'}
              {x.farmer.phone && (
                <>
                  {' · '}
                  <a href={`tel:+${x.farmer.phone}`} className="underline">
                    {t.web.common.call}
                  </a>
                </>
              )}
            </p>
          )}
          {x.rebookedBookingId && (
            <p className="text-sm text-brand-dark">
              {fmt(f.rebooked, { ref: x.rebookedBookingId })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
