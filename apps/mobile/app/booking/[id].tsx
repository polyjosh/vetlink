import { Redirect, useLocalSearchParams } from 'expo-router';
import { Loading } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { lastRole } from '../../src/lib/role';
import { useSession } from '../../src/lib/session';

/** Deep link `vetlink://booking/:id` (SMS links, tapped notifications): the right screen per role. */
export default function BookingLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, me } = useSession();
  const { t } = useT();
  if (status === 'signed_out') return <Redirect href="/login" />;
  if (status === 'loading') return <Loading label={t.web.common.loading} />;
  const roles = me?.roles ?? [];
  const asVet = roles.includes('vet') && (lastRole() === 'vet' || !roles.includes('farmer'));
  return <Redirect href={asVet ? `/vet/job/${id}` : `/farmer/bookings/${id}`} />;
}
