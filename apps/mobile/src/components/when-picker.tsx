import { useState } from 'react';
import { View } from 'react-native';
import { SCHEDULE_DAYS_AHEAD, SCHEDULE_PARTS, eatDateOf, type SchedulePart } from '@vetlink/shared';
import { space } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { Choices, P } from './ui';

export type When = { kind: 'asap' } | { kind: 'later'; date: string; part: SchedulePart };

/** "When?" (§24.10): as soon as possible, or a day in the next 14 and a part of it. */
export function WhenPicker({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const { t, lang } = useT();
  const s = t.web.schedule;
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
    <View style={{ gap: space.sm }}>
      <Choices
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
          <P>{s.date}</P>
          <Choices
            options={days.map((d) => ({ value: d, label: label(d) }))}
            value={value.date}
            onChange={(date) => onChange({ ...value, date })}
          />
          <P>{s.part}</P>
          <Choices
            options={SCHEDULE_PARTS.map((p) => ({ value: p, label: s.partLabels[p] }))}
            value={value.part}
            onChange={(part) => onChange({ ...value, part })}
          />
          <P muted>{s.laterHint}</P>
        </>
      )}
    </View>
  );
}

/** "Appointment: Fri 16 Oct, morning" (Nairobi date). */
export function AppointmentLine({
  scheduledFor,
  part,
}: {
  scheduledFor: string | null | undefined;
  part: SchedulePart | null | undefined;
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
    <P>{`📅 ${fmt(t.web.schedule.appointment, { date, part: t.web.schedule.parts[part] })}`}</P>
  );
}
