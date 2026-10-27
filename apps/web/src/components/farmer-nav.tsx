'use client';

import { useT } from '@/lib/i18n';
import { NavLink } from './ui';

export function FarmerNav() {
  const { t } = useT();
  return (
    <>
      <NavLink href="/farmer" exact>
        {t.web.ui.nav.home}
      </NavLink>
      <NavLink href="/farmer/animals">{t.web.ui.nav.animals}</NavLink>
      <NavLink href="/farmer/bookings">{t.web.ui.nav.bookings}</NavLink>
    </>
  );
}
