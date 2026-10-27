'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { resolveHomeRoute, type SessionRole } from '@vetlink/shared';
import { useT } from '@/lib/i18n';
import { ROUTE_PATHS, lastRole, rememberRole } from '@/lib/role';
import { useSession } from '@/lib/session';
import { AccountMenu, Icon, LanguageToggle, Logo, Spinner, TopBar } from './ui';

/**
 * Page frame. Farmer, vet and signed-out pages: the top bar and a centred column (`wide` for
 * dashboards, up to the 1200 px content width). Admin pages: the dark sidebar with the 2FA state.
 */
export function Shell({
  title,
  subtitle,
  role,
  children,
  nav,
  wide,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  role?: SessionRole;
  children: ReactNode;
  nav?: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  const heading = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-title sm:text-display sm:tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
  if (role === 'admin' && nav) {
    return (
      <AdminFrame nav={nav}>
        {heading}
        {children}
      </AdminFrame>
    );
  }
  return (
    <div className="min-h-screen">
      <TopBar nav={nav} role={role} />
      <main
        className={`mx-auto px-4 pt-6 pb-16 sm:px-6 sm:pt-8 ${wide ? 'max-w-content' : 'max-w-3xl'}`}
      >
        {heading}
        {children}
      </main>
    </div>
  );
}

function AdminFrame({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const { t, fmt } = useT();
  const { me } = useSession();
  const admin = me?.admin;
  const roleName = admin ? t.web.admin.adminRoles[admin.role] : '';
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="flex max-w-full flex-[1_1_240px] flex-col gap-6 bg-ink px-4 py-5 text-on-primary wrap:max-w-72">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <Logo boxed={false} label={t.web.ui.adminBrand} />
          <div className="flex items-center gap-2 wrap:hidden">
            <LanguageToggle inverse />
            <AccountMenu role="admin" />
          </div>
        </div>
        <nav aria-label={t.web.admin.navLabel} className="flex flex-col gap-0.5">
          {nav}
        </nav>
        {admin?.twoFactorVerified && (
          <p className="mt-auto flex items-center gap-2 rounded-md bg-on-primary/5 p-3 text-small text-on-primary-muted">
            <span className="text-online">
              <Icon name="shieldCheck" size={16} />
            </span>
            {fmt(t.web.admin.twoFactorActive, { role: roleName })}
          </p>
        )}
      </aside>
      <main className="min-w-0 flex-[999_1_640px] px-4 pt-7 pb-12 sm:px-8">
        <div className="mb-4 hidden justify-end gap-3 wrap:flex">
          <LanguageToggle />
          <AccountMenu role="admin" />
        </div>
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
