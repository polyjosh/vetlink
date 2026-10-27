'use client';

import type { ReactNode } from 'react';
import type { Tone } from '@vetlink/ui-tokens';

export type NoticeTone = 'info' | 'warning' | 'success' | 'danger';

const tones: Record<Tone, string> = {
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-ink-muted',
};

export function toneClass(tone: Tone): string {
  return tones[tone];
}

/** Surface card: border by default (cheap in long lists), `raised` for sheets and sticky bars. */
export function Card({
  children,
  className = '',
  raised,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={`rounded-lg border border-border bg-surface p-4 sm:p-6 ${raised ? 'shadow-raised' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-soft p-3 text-danger">
      {message}
    </p>
  );
}

export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  return <div className={`rounded-md p-3 ${tones[tone]}`}>{children}</div>;
}

export function Badge({ children, tone = 'info' }: { children: ReactNode; tone?: NoticeTone }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-small font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="py-8 text-center text-ink-muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** Small uppercase section label (`type.label`). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-label tracking-wide text-ink-muted uppercase">{children}</h2>;
}
