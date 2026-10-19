'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { resolveHomeRoute, type SessionRole } from '@vetlink/shared';
import { useLang, useT } from '@/lib/i18n';
import { ROUTE_PATHS, lastRole, rememberRole } from '@/lib/role';
import { useSession } from '@/lib/session';
import { Spinner } from './ui';
import { PersonAvatar } from './pictures';

/** Page frame: title bar, language toggle, role switcher for multi-role users, log out. */
export function Shell({
  title,
  role,
  children,
  nav,
}: {
  title: string;
  role?: SessionRole;
  children: ReactNode;
  nav?: ReactNode;
}) {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const { me, logout } = useSession();
  const router = useRouter();
  const otherRoles = (me?.roles ?? []).filter((r) => r !== role);
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-3 py-4">
        <Link href="/" className="text-xl font-bold text-brand">
          VetLink
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          className="min-h-touch px-2 text-sm underline"
          onClick={() => setLang(lang === 'sw' ? 'en' : 'sw')}
        >
          {lang === 'sw' ? t.web.common.english : t.web.common.swahili}
        </button>
        {otherRoles.map((r) => (
          <button
            key={r}
            type="button"
            className="min-h-touch px-2 text-sm underline"
            onClick={() => {
              rememberRole(r);
              router.push('/');
            }}
          >
            {t.web.common.switchRole} {t.web.roles[r]}
          </button>
        ))}
        {me && (
          <Link
            href="/settings"
            className="flex min-h-touch items-center gap-2 px-2 text-sm underline"
          >
            <PersonAvatar url={me.photo.url} name={me.displayName ?? me.name} size={32} />
            {t.web.profile.title}
          </Link>
        )}
        {me && (
          <button
            type="button"
            className="min-h-touch px-2 text-sm underline"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            {t.web.common.logout}
          </button>
        )}
      </header>
      {nav && <nav className="mb-4 flex flex-wrap gap-2">{nav}</nav>}
      <main>
        <h1 className="mb-4 text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/**
 * Client route guard (UX only, §8.0): waits for the session, then sends the user to the screen
 * their state calls for if this page is not it. The API enforces access regardless.
 */
export function RequireRole({
  role,
  children,
  allow,
}: {
  role: SessionRole;
  children: ReactNode;
  allow?: string[];
}) {
  const { status, me } = useSession();
  const { t } = useT();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed_out') router.replace('/login');
    if (status !== 'signed_in' || !me) return;
    if (!me.roles.includes(role)) {
      router.replace('/');
      return;
    }
    rememberRole(role);
    const { route } = resolveHomeRoute(me, role);
    const target = ROUTE_PATHS[route];
    const here = window.location.pathname;
    if (!here.startsWith(target) && !(allow ?? []).some((p) => here.startsWith(p)))
      router.replace(target);
  }, [status, me, role, router, allow]);
  if (status !== 'signed_in' || !me?.roles.includes(role))
    return <Spinner label={t.web.common.loading} />;
  return <>{children}</>;
}

export { lastRole };
