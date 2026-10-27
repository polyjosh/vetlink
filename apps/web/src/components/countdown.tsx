'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { Badge } from './ui';

/** Time left until `until`, ticking every second (minutes:seconds above 90 s). */
/** `plain`: the text alone, for a coloured band that already says it is urgent. */
export function Countdown({ until, plain }: { until: string; plain?: boolean }) {
  const { t, fmt } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  const text =
    s === 0
      ? t.web.vet.expired
      : s > 90
        ? fmt(t.web.choose.timeLeft, {
            minutes: Math.floor(s / 60),
            seconds: String(s % 60).padStart(2, '0'),
          })
        : fmt(t.web.vet.timeLeft, { seconds: s });
  if (plain) return <span role="timer">{text}</span>;
  return <Badge tone={s > 0 ? 'warning' : 'danger'}>{text}</Badge>;
}
