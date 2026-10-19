'use client';

import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/** Large, high-contrast controls for small screens and bright light (§4.3). */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:opacity-50',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas disabled:opacity-50',
  danger: 'bg-emergency text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-brand underline-offset-2 hover:underline',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`min-h-touch rounded-control px-4 py-2 text-base font-semibold ${variants[variant]} ${className}`}
    />
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  children,
  className = '',
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-touch items-center justify-center rounded-control px-4 py-2 text-base font-semibold ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 ${className}`}>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-sm text-muted">{hint}</span>}
    </label>
  );
}

const control =
  'min-h-touch w-full rounded-control border border-line bg-surface px-3 py-2 text-base';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-control bg-emergency-light p-3 text-emergency">
      {message}
    </p>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'success' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-info-light text-info',
    warning: 'bg-warning-light text-warning',
    success: 'bg-brand-light text-brand-dark',
    danger: 'bg-emergency-light text-emergency',
  };
  return <div className={`rounded-control p-3 ${tones[tone]}`}>{children}</div>;
}

export function Badge({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success' | 'danger';
}) {
  const tones = {
    info: 'bg-info-light text-info',
    warning: 'bg-warning-light text-warning',
    success: 'bg-brand-light text-brand-dark',
    danger: 'bg-emergency-light text-emergency',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-sm font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="py-8 text-center text-muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** A choice made by tapping one big card (icon grid style, §8.2). */
export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-touch rounded-card border-2 p-3 text-left font-semibold ${value === o.value ? 'border-brand bg-brand-light' : 'border-line bg-surface'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
