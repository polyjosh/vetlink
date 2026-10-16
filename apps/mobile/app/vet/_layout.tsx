import { Stack } from 'expo-router';
import { RequireRole } from '../../src/components/screen';

// The application and status screens stay reachable whatever the verification state.
export default function VetLayout() {
  return (
    <RequireRole role="vet" allow={['/vet/application', '/vet/status']}>
      <Stack screenOptions={{ headerShown: false }} />
    </RequireRole>
  );
}
