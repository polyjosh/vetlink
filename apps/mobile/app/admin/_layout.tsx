import { Stack } from 'expo-router';
import { RequireRole } from '../../src/components/screen';

/**
 * Admin essentials only (§11, §13): 2FA and the verification queue. The full console is on the
 * web. Route modules load on first visit, so farmers and vets never run this code.
 */
export default function AdminLayout() {
  return (
    <RequireRole role="admin" allow={['/admin']}>
      <Stack screenOptions={{ headerShown: false }} />
    </RequireRole>
  );
}
