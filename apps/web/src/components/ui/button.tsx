'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { IconName } from '@vetlink/ui-tokens';
import { Icon } from './icon';

/**
 * Buttons (design system v1). `accent` (amber, ink text) is for urgent or emergency actions only;
 * one primary action per screen.
 */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'xl' | 'lg' | 'md';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-pressed',
  accent: 'bg-accent text-ink hover:brightness-95',
  secondary: 'border-strong border-primary bg-surface text-primary hover:bg-primary-soft',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'border-strong border-danger bg-surface text-danger hover:bg-danger-soft',
};

const sizes: Record<ButtonSize, string> = {
  xl: 'min-h-button-xl px-5 text-button',
  lg: 'min-h-button-lg px-5 text-button',
  md: 'min-h-button-md px-4 text-body font-bold',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return `inline-flex items-center justify-center gap-2 rounded-md text-center font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`;
}

function Content({
  icon,
  trailingIcon,
  children,
}: {
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  children: ReactNode;
}) {
  return (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} />}
    </>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  trailingIcon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
}) {
  return (
    <button {...props} className={buttonClass(variant, size, className)}>
      <Content icon={icon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  trailingIcon,
  children,
  className = '',
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      <Content icon={icon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </Link>
  );
}
