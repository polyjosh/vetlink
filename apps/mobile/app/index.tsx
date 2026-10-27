import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { resolveHomeRoute } from '@vetlink/shared';
import { Loading } from '../src/components/ui';
import { useLang, useT } from '../src/lib/i18n';
import { ROUTE_PATHS, lastRole } from '../src/lib/role';
import { useSession } from '../src/lib/session';

/** The route resolver (§8.0): one login, then each user goes where their state says. */
export default function Index() {
  const { status, me } = useSession();
  const { setLang } = useLang();
  const { t } = useT();
  useEffect(() => {
    if (me?.language === 'sw' || me?.language === 'en') setLang(me.language);
  }, [me?.language, setLang]);
  if (status === 'signed_out') return <Redirect href="/login" />;
  if (me) return <Redirect href={ROUTE_PATHS[resolveHomeRoute(me, lastRole()).route]} />;
  if (status === 'offline') {
    const role = lastRole();
    return <Redirect href={role === 'vet' ? '/vet' : role === 'admin' ? '/admin' : '/farmer'} />;
  }
  return <Loading label={t.web.common.loading} />;
}
