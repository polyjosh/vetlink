'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SessionRole } from '@vetlink/shared';
import { useT } from '@/lib/i18n';
import { rememberRole } from '@/lib/role';
import { useSession } from '@/lib/session';
import { PersonAvatar } from '../pictures';
import { LanguageToggle } from './language-toggle';
import { Logo } from './logo';

/** A section link; active when the path is it (or below it, unless `exact`). */
export function NavLink({
  href,
  children,
  exact,
  inverse,
  badge,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  inverse?: boolean;
  badge?: ReactNode;
}) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  const tone = inverse
    ? active
      ? 'bg-on-primary/10 text-on-primary font-bold'
      : 'text-on-primary-muted hover:text-on-primary'
    : active
      ? 'bg-primary-soft text-primary font-bold'
      : 'text-ink-muted hover:text-ink';
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-touch items-center justify-between gap-2 rounded-md px-3.5 font-semibold ${tone}`}
    >
      {children}
      {badge}
    </Link>
  );
}

/** Avatar button opening the account menu: settings, other roles, log out. */
export function AccountMenu({ role }: { role?: SessionRole | undefined }) {
  const { t } = useT();
  const { me, logout } = useSession();
  const router = useRouter();
  if (!me) return null;
  const item = 'flex min-h-touch w-full items-center px-4 text-left font-semibold hover:bg-ground';
  return (
    <details className="relative">
      <summary
        aria-label={t.web.ui.account}
        className="flex size-touch cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden"
      >
        <PersonAvatar url={me.photo.url} name={me.displayName ?? me.name} size={40} />
      </summary>
      <div className="absolute right-0 z-20 mt-2 min-w-56 overflow-hidden rounded-md border border-border bg-surface py-1 text-ink shadow-overlay">
        <Link href="/settings" className={item}>
          {t.web.profile.title}
        </Link>
        {me.roles
          .filter((r) => r !== role)
          .map((r) => (
            <button
              key={r}
              type="button"
              className={item}
              onClick={() => {
                rememberRole(r);
                router.push('/');
              }}
            >
              {t.web.common.switchRole} {t.web.roles[r]}
            </button>
          ))}
        <button
          type="button"
          className={item}
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          {t.web.common.logout}
        </button>
      </div>
    </details>
  );
}

/** Web header: logo, section links (active = primarySoft), language toggle, account. Wraps. */
export function TopBar({ nav, role }: { nav?: ReactNode; role?: SessionRole | undefined }) {
  const { t } = useT();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Logo />
        <nav
          aria-label={t.web.ui.mainNav}
          className="order-last flex w-full flex-wrap gap-1 md:order-none md:w-auto md:flex-1"
        >
          {nav}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageToggle />
          <AccountMenu role={role} />
        </div>
      </div>
    </header>
  );
}
