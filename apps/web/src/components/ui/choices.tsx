'use client';

import type { ReactNode } from 'react';
import type { BookingStatus } from '@vetlink/shared';
import { statusToneName } from '@vetlink/ui-tokens';
import { useT } from '@/lib/i18n';
import { toneClass } from './feedback';
import { Icon } from './icon';

/** 44 px pill toggle. Unselected: white with a border; selected: solid primary. */
export function ChoiceChip({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-chip items-center rounded-full border-strong px-4 font-semibold disabled:opacity-50 ${selected ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-ink hover:border-primary'}`}
    >
      {children}
    </button>
  );
}

/** A non-interactive pill (filters, tags). */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-chip items-center rounded-full border-strong border-border bg-surface px-4 font-semibold">
      {children}
    </span>
  );
}

/**
 * 72 px tile with the label in the UI language and, under it, the name in the other language
 * (e.g. "Ng'ombe / Cow") for farmers who read one better. The second line is hidden from screen
 * readers so the accessible name is the UI-language label.
 */
export function ChoiceTile({
  label,
  secondary,
  selected,
  onClick,
  tone = 'primary',
}: {
  label: string;
  secondary?: string | undefined;
  selected: boolean;
  onClick: () => void;
  tone?: 'primary' | 'warning';
}) {
  const on =
    tone === 'warning' ? 'border-warning bg-warning-soft' : 'border-primary bg-primary-soft';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-tile flex-col items-start justify-center rounded-tile border-2 px-3 py-2 text-left ${selected ? on : 'border-border bg-surface hover:border-primary'}`}
    >
      <span className="font-bold">{label}</span>
      {secondary && secondary !== label && (
        <span aria-hidden className="text-small text-ink-muted">
          {secondary}
        </span>
      )}
    </button>
  );
}

/** A choice made by tapping one big tile (icon grid style, §8.2). */
export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { value: T; label: string; secondary?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid gap-3 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {options.map((o) => (
        <ChoiceTile
          key={o.value}
          label={o.label}
          secondary={o.secondary}
          selected={value === o.value}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}

/** Booking status as text on its tone: status is never shown by colour alone. */
export function StatusChip({
  status,
  testId,
  className = '',
}: {
  status: BookingStatus;
  testId?: string;
  className?: string;
}) {
  const { t } = useT();
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded-full px-3 py-1 text-small font-bold ${toneClass(statusToneName[status])} ${className}`}
    >
      {t.ussd.statuses[status]}
    </span>
  );
}

export function VerifiedBadge({ withHint }: { withHint?: boolean }) {
  const { t } = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1.5 pr-3 pl-2 text-small font-bold text-primary">
        <Icon name="shieldCheck" size={18} />
        {t.web.ui.verifiedVet}
      </span>
      {withHint && <span className="text-small text-ink-muted">{t.web.ui.verifiedHint}</span>}
    </span>
  );
}
