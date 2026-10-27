'use client';

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

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
    <label className="block space-y-2">
      <span className="block text-small font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-small text-ink-muted">{hint}</span>}
    </label>
  );
}

const control =
  'min-h-touch w-full rounded-md border-strong border-border bg-surface px-3 py-2 text-body text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-4 focus:ring-primary-soft';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} ${props.className ?? ''}`} />;
}

/** Kenya's country code: the phone field shows it as a fixed prefix. */
export const COUNTRY_CODE = '+254';

/**
 * The number the farmer typed after the +254 prefix, as one the API accepts. A pasted full
 * number (`+2547…`, `2547…`) is kept; a leading 0 is dropped (`0712…` → `+254712…`).
 */
export function withCountryCode(local: string): string {
  const digits = local.replace(/\D/g, '');
  if (digits.startsWith('254')) return `+${digits}`;
  return `${COUNTRY_CODE}${digits.replace(/^0/, '')}`;
}

/** 56 px phone input with a fixed +254 block (design system v1). */
export function PhoneInput({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span
      className={`flex min-h-input overflow-hidden rounded-md border-strong border-border bg-surface focus-within:border-primary focus-within:ring-4 focus-within:ring-primary-soft ${className}`}
    >
      <span
        aria-hidden
        className="flex items-center border-r border-border bg-ground px-3 text-button"
      >
        {COUNTRY_CODE}
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        {...props}
        className="min-w-0 flex-1 bg-transparent px-3 text-button font-normal text-ink outline-none placeholder:text-ink-muted"
      />
    </span>
  );
}
