import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './session';

/**
 * Push (§8.7, §11). Channels exist from the start; the permission is asked in context (a vet going
 * online, a farmer after their first request), never at first launch.
 */
export async function setUpChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Loud, high priority: job offers and emergencies.
  await Notifications.setNotificationChannelAsync('offers', {
    name: 'Job offers / Kazi',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Updates / Taarifa',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Ask (once, in context) and register this device's push token with the API. */
export async function enablePush(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!granted || !projectId) {
    await api.POST('/v1/devices', { body: { notificationsEnabled: false } }).catch(() => undefined);
    return false;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api
    .POST('/v1/devices', { body: { pushToken: data, notificationsEnabled: true } })
    .catch(() => undefined);
  return true;
}

/** The booking a tapped notification is about, if any. */
export function bookingIdOf(response: Notifications.NotificationResponse): number | null {
  const id = Number(response.notification.request.content.data?.bookingId);
  return Number.isInteger(id) && id > 0 ? id : null;
}
