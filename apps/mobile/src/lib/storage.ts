import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

/** Secrets (the refresh token) live in the Keychain / Keystore (§11). */
export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};

/** Small non-secret values (language, last role, cached screens) in SQLite. */
export const kv = {
  get(key: string): string | null {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      Storage.setItemSync(key, value);
    } catch {
      // cache only: losing it is harmless
    }
  },
  remove(key: string): void {
    try {
      Storage.removeItemSync(key);
    } catch {
      // ignore
    }
  },
};

/** Cached JSON for offline screens (active job, history, animals). */
export function readCache<T>(key: string): T | undefined {
  const raw = kv.get(`cache:${key}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown): void {
  kv.set(`cache:${key}`, JSON.stringify(value));
}

export function clearUserData(): void {
  try {
    for (const k of Storage.getAllKeysSync()) if (k.startsWith('cache:')) Storage.removeItemSync(k);
  } catch {
    // ignore
  }
}
