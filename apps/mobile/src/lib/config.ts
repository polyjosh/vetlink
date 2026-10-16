import Constants from 'expo-constants';

/**
 * Where the API is. Set EXPO_PUBLIC_API_URL (inlined at build time). The default reaches the dev
 * machine from the Android emulator.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
