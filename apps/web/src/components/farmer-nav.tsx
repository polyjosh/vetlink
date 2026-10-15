'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

export function FarmerNav() {
  const { t } = useT();
  const link = 'rounded-full border border-line bg-surface px-3 py-2 text-sm font-semibold';
  return (
    <>
      <Link className={link} href="/farmer">
        {t.web.common.home}
      </Link>
      <Link className={link} href="/farmer/bookings">
        {t.web.farmer.history}
      </Link>
      <Link className={link} href="/farmer/animals">
        {t.web.farmer.myAnimals}
      </Link>
    </>
  );
}
