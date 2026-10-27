import { Stack } from 'expo-router';
import { View } from 'react-native';
import { RequireRole } from '../../src/components/screen';
import { BottomNav } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useSession } from '../../src/lib/session';

// The application and status screens stay reachable whatever the verification state; the tabs
// appear once the vet is approved.
export default function VetLayout() {
  const { t } = useT();
  const { me } = useSession();
  const approved = me?.vet?.verificationStatus === 'approved';
  return (
    <RequireRole role="vet" allow={['/vet/application', '/vet/status']}>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
        {approved && (
          <BottomNav
            items={[
              { href: '/vet', label: t.web.ui.nav.jobs, icon: 'jobs', exact: true },
              { href: '/vet/history', label: t.web.ui.nav.history, icon: 'history' },
              { href: '/vet/ratings', label: t.web.ui.nav.ratings, icon: 'star' },
              { href: '/vet/profile', label: t.web.ui.nav.profile, icon: 'user' },
            ]}
          />
        )}
      </View>
    </RequireRole>
  );
}
