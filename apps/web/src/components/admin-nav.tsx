'use client';

import type { AdminRole } from '@vetlink/shared';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { NavLink } from './ui';

/** Only the sections this admin's permissions allow (UX; the API enforces each one). */
const SECTIONS: {
  href: string;
  key: 'applications' | 'photos' | 'flags' | 'bookings' | 'payments' | 'config' | 'admins';
  needs: AdminRole;
}[] = [
  { href: '/admin/applications', key: 'applications', needs: 'verifier' },
  { href: '/admin/photos', key: 'photos', needs: 'verifier' },
  { href: '/admin/flags', key: 'flags', needs: 'verifier' },
  { href: '/admin/bookings', key: 'bookings', needs: 'support' },
  { href: '/admin/payments', key: 'payments', needs: 'finance' },
  { href: '/admin/config', key: 'config', needs: 'super_admin' },
  { href: '/admin/admins', key: 'admins', needs: 'super_admin' },
];

export function AdminNav() {
  const { t } = useT();
  const { me } = useSession();
  const perms = me?.admin?.permissions ?? [];
  return (
    <>
      {SECTIONS.filter((s) => perms.includes(s.needs)).map((s) => (
        <NavLink key={s.href} href={s.href} inverse>
          {t.web.admin.nav[s.key]}
        </NavLink>
      ))}
    </>
  );
}

export function firstAdminSection(perms: readonly AdminRole[]): string {
  return SECTIONS.find((s) => perms.includes(s.needs))?.href ?? '/admin/bookings';
}
