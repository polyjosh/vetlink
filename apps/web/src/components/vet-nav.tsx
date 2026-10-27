'use client';

import { useT } from '@/lib/i18n';
import { NavLink } from './ui';

export function VetNav() {
  const { t } = useT();
  return (
    <>
      <NavLink href="/vet" exact>
        {t.web.ui.nav.jobs}
      </NavLink>
      <NavLink href="/vet/history">{t.web.ui.nav.history}</NavLink>
      <NavLink href="/vet/ratings">{t.web.ui.nav.ratings}</NavLink>
      <NavLink href="/vet/follow-ups">{t.web.ui.nav.followUps}</NavLink>
      <NavLink href="/vet/profile">{t.web.ui.nav.profile}</NavLink>
      <NavLink href="/vet/status">{t.web.application.statusTitle}</NavLink>
    </>
  );
}
