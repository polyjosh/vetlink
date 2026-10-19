'use client';

import { useState } from 'react';
import { SCHEDULE_DAYS_AHEAD, SCHEDULE_PARTS, eatDateOf, type SchedulePart } from '@vetlink/shared';
import { useT } from '@/lib/i18n';
import { ChoiceGrid, Field, Select } from './ui';

export type When = { kind: 'asap' } | { kind: 'later'; date: string; part: SchedulePart };

/** "When?" (§24.10): as soon as possible, or a day in the next 14 and a part of it. */
export function WhenPicker({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const { t, lang } = useT();
  const s = t.web.schedule;
  // The next 14 days in Nairobi, fixed when the picker opens.
  const [days] = useState(() => {
    const now = Date.now();
    return Array.from({ length: SCHEDULE_DAYS_AHEAD + 1 }, (_, i) =>
      eatDateOf(new Date(now + i * 24 * 3600 * 1000)),
    );
  });
  const label = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(lang, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <div className="space-y-3">
      <ChoiceGrid
        options={[
          { value: 'asap' as const, label: s.asap },
          { value: 'later' as const, label: s.later },
        ]}
        value={value.kind}
        onChange={(k) =>
          onChange(
            k === 'asap'
              ? { kind: 'asap' }
              : { kind: 'later', date: days[1] ?? days[0] ?? '', part: 'morning' },
          )
        }
      />
      {value.kind === 'later' && (
        <>
          <Field label={s.date}>
            <Select
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value })}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {label(d)}
                </option>
              ))}
            </Select>
          </Field>
          <ChoiceGrid
            options={SCHEDULE_PARTS.map((p) => ({ value: p, label: s.partLabels[p] }))}
            value={value.part}
            onChange={(part) => onChange({ ...value, part })}
          />
          <p className="text-sm text-muted">{s.laterHint}</p>
        </>
      )}
    </div>
  );
}

/** "Appointment: Fri 16 Oct, morning" (Nairobi date). */
export function AppointmentLine({
  scheduledFor,
  part,
}: {
  scheduledFor: string | null;
  part: SchedulePart | null;
}) {
  const { t, fmt, lang } = useT();
  if (!scheduledFor || !part) return null;
  const date = new Date(scheduledFor).toLocaleDateString(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Nairobi',
  });
  return (
    <p className="font-semibold">
      📅 {fmt(t.web.schedule.appointment, { date, part: t.web.schedule.parts[part] })}
    </p>
  );
}
