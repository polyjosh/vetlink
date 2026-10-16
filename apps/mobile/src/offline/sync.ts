import { randomUUID } from 'expo-crypto';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { api } from '../lib/session';
import { Outbox, memoryStore, type OutboxItem, type OutboxOp } from './outbox';
import { createSender, type SenderApi } from './send';
import { sqliteStore } from './sqlite-store';

const senderApi: SenderApi = {
  postStatus: (id, status) =>
    api.POST('/v1/bookings/{id}/status', { params: { path: { id } }, body: { status } }),
  postComplete: (id, body) =>
    api.POST('/v1/bookings/{id}/complete', { params: { path: { id } }, body }),
  getBookingStatus: async (id) => {
    const res = await api.GET('/v1/bookings/{id}', { params: { path: { id } } });
    return { ...res, ...(res.data && { status: res.data.status }) };
  },
  // Presign → PUT the (already compressed) file straight to storage → confirm (§8.3).
  uploadDocument: async (op) => {
    const p = await api.POST('/v1/uploads/presign', {
      body: {
        purpose: 'vet_document',
        documentKind: op.docKind,
        contentType: op.contentType,
        size: op.size,
      },
    });
    if (!p.data) return p;
    const file = await (await fetch(op.fileUri)).blob();
    const put = await fetch(p.data.uploadUrl, {
      method: 'PUT',
      headers: p.data.headers,
      body: file,
    });
    if (!put.ok) return { error: { code: 'upload_failed' }, response: { status: put.status } };
    return api.POST('/v1/vets/me/application/documents', {
      body: { kind: op.docKind, storageKey: p.data.storageKey },
    });
  },
};

function openStore() {
  try {
    return sqliteStore();
  } catch {
    return memoryStore();
  }
}

export const outbox = new Outbox(openStore(), createSender(senderApi), randomUUID);

/** What the "pending sync" badge and job screens show. */
export const useSync = create<{ items: OutboxItem[] }>(() => ({ items: [] }));

async function refreshState() {
  useSync.setState({ items: await outbox.items() });
}

export async function enqueue(op: OutboxOp): Promise<void> {
  await outbox.enqueue(op);
  void flushSoon();
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function flushSoon(): Promise<void> {
  try {
    await outbox.flush();
  } finally {
    await refreshState();
  }
}

/** Flush when the connection returns, when the app comes to the front, and every 30 s while waiting. */
export function startSync(): () => void {
  const unsubscribe = outbox.subscribe(() => void refreshState());
  const net = Network.addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void flushSoon();
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void flushSoon();
  });
  timer = setInterval(() => {
    if (useSync.getState().items.some((i) => i.state === 'pending')) void flushSoon();
  }, 30_000);
  void flushSoon();
  return () => {
    unsubscribe();
    net.remove();
    app.remove();
    if (timer) clearInterval(timer);
  };
}
