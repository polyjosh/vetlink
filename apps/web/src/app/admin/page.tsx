'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui';
import { firstAdminSection } from '@/components/admin-nav';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function AdminHome() {
  const { me } = useSession();
  const { t } = useT();
  const router = useRouter();
  useEffect(() => {
    if (!me?.admin) return;
    if (!me.admin.twoFactorVerified) router.replace('/admin/verify');
    else router.replace(firstAdminSection(me.admin.permissions));
  }, [me, router]);
  return <Spinner label={t.web.common.loading} />;
}
