import { Stack } from 'expo-router';
import { RequireRole } from '../../src/components/screen';

export default function FarmerLayout() {
  return (
    <RequireRole role="farmer">
      <Stack screenOptions={{ headerShown: false }} />
    </RequireRole>
  );
}
