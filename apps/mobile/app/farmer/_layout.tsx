import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { RequireRole } from '../../src/components/screen';
import { BottomNav } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';

// The request flow has its own sticky bar, so the tabs step aside there.
const NO_NAV = ['/farmer/request'];

export default function FarmerLayout() {
  const { t } = useT();
  const path = usePathname();
  return (
    <RequireRole role="farmer">
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
        {!NO_NAV.some((p) => path.startsWith(p)) && (
          <BottomNav
            items={[
              { href: '/farmer', label: t.web.ui.nav.home, icon: 'home', exact: true },
              { href: '/farmer/animals', label: t.web.ui.nav.animals, icon: 'animals' },
              { href: '/farmer/bookings', label: t.web.ui.nav.bookings, icon: 'calendar' },
              { href: '/settings', label: t.web.ui.nav.profile, icon: 'user' },
            ]}
          />
        )}
      </View>
    </RequireRole>
  );
}
