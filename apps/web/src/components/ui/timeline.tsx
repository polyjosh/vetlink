'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { Icon } from './icon';

export type TimelineState = 'done' | 'current' | 'upcoming';

/** Vertical step list: done (filled primary with a check), current (info ring), upcoming (grey). */
export function Timeline({
  steps,
}: {
  steps: { key: string; label: string; meta?: ReactNode; state: TimelineState }[];
}) {
  const { t } = useT();
  const sr = {
    done: t.web.ui.stepDone,
    current: t.web.ui.stepNow,
    upcoming: t.web.ui.stepUpcoming,
  };
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={`absolute top-7 bottom-0 left-[13px] w-0.5 ${s.state === 'done' ? 'bg-primary' : 'bg-border'}`}
            />
          )}
          <span
            aria-hidden
            className={`relative flex size-7 shrink-0 items-center justify-center rounded-full ${
              s.state === 'done'
                ? 'bg-primary text-on-primary'
                : s.state === 'current'
                  ? 'border-[3px] border-info bg-info-soft'
                  : 'border-2 border-border bg-surface'
            }`}
          >
            {s.state === 'done' && <Icon name="check" size={16} />}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 pt-0.5">
            <span className="sr-only">{sr[s.state]}: </span>
            <span
              className={
                s.state === 'current'
                  ? 'font-bold text-info'
                  : `font-semibold ${s.state === 'upcoming' ? 'text-ink-muted' : 'text-ink'}`
              }
            >
              {s.label}
            </span>
            {s.meta && <span className="ml-auto text-small text-ink-muted">{s.meta}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
