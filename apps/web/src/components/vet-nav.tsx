'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

export function VetNav() {
  const { t } = useT();
  const link = 'rounded-full border border-line bg-surface px-3 py-2 text-sm font-semibold';
  return (
    <>
      <Link className={link} href="/vet">
        {t.web.common.home}
      </Link>
      <Link className={link} href="/vet/history">
        {t.web.vet.jobHistory}
      </Link>
      <Link className={link} href="/vet/profile">
        {t.web.vetProfile.title}
      </Link>
      <Link className={link} href="/vet/status">
        {t.web.application.statusTitle}
      </Link>
    </>
  );
}
