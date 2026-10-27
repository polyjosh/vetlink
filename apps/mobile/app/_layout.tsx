import '../src/lib/polyfills';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FONT_FILES, setFontsLoaded } from '../src/components/ui/text';
import { bookingIdOf, setUpChannels } from '../src/lib/push';
import { LangProvider } from '../src/lib/i18n';
import { SessionProvider } from '../src/lib/session';
import { startSync } from '../src/offline/sync';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000, networkMode: 'offlineFirst' } },
});

// TanStack Query follows the phone's connection and app focus (React Native has no window events).
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected));
  return () => sub.remove();
});
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});

export default function RootLayout() {
  // Figtree ships in the bundle, so this resolves almost at once; on failure the system font is
  // used instead (design system v1, 2026-10-27).
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  useEffect(() => {
    void setUpChannels();
    const stopSync = startSync();
    // A tapped notification opens its booking (offers and updates carry bookingId).
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const id = bookingIdOf(r);
      if (id) router.push(`/booking/${id}`);
    });
    return () => {
      stopSync();
      tap.remove();
    };
  }, []);
  if (!fontsLoaded && !fontError) return null;
  setFontsLoaded(fontsLoaded);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LangProvider>
          <SessionProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </SessionProvider>
        </LangProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
