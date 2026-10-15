'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { resolveHomeRoute } from '@vetlink/shared';
import { Spinner } from '@/components/ui';
import { useLang, useT } from '@/lib/i18n';
import { ROUTE_PATHS, lastRole } from '@/lib/role';
import { useSession } from '@/lib/session';

/** The route resolver (§8.0): one login, then each user goes where their state says. */
export default function Home() {
  const { status, me } = useSession();
  const { setLang } = useLang();
  const { t } = useT();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed_out') router.replace('/login');
    if (status === 'signed_in' && me) {
      if (me.language === 'sw' || me.language === 'en') setLang(me.language);
      router.replace(ROUTE_PATHS[resolveHomeRoute(me, lastRole()).route]);
    }
  }, [status, me, router, setLang]);
  return <Spinner label={t.web.common.loading} />;
}
