import type { VetDocumentKind } from '@vetlink/shared';

/**
 * Offline outbox (§11): writes made without a connection are queued on the device and sent in
 * order when it returns. Booking status is decided by the server (its state machine wins);
 * treatments are append-only, so a completed job never conflicts.
 */
export type OutboxOp =
  | { kind: 'booking_status'; bookingId: number; status: 'en_route' | 'in_service' }
  | {
      kind: 'booking_complete';
      bookingId: number;
      body: {
        diagnosis?: string;
        drugsUsed?: string;
        notes?: string;
        followUpDate?: string;
        clientCreatedAt: string;
      };
    }
  | {
      kind: 'document_upload';
      docKind: VetDocumentKind;
      fileUri: string;
      contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
      size: number;
    };

export interface OutboxItem {
  id: string;
  op: OutboxOp;
  createdAt: string;
  attempts: number;
  /** pending: will be sent; failed: the server refused it for good (shown to the user). */
  state: 'pending' | 'failed';
  lastError: string | null;
}

export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * What happened when an item was sent:
 * - `done`: the server has it (including "it already had it", after a lost response);
 * - `retry`: no connection, a timeout or a server hiccup: keep it and try later;
 * - `{ failed }`: refused for good (e.g. the farmer cancelled while the vet was offline).
 */
export type SendResult = 'done' | 'retry' | { failed: string };

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

export class Outbox {
  private flushing: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly store: OutboxStore,
    private readonly send: (op: OutboxOp) => Promise<SendResult>,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(op: OutboxOp): Promise<OutboxItem> {
    const item: OutboxItem = {
      id: this.newId(),
      op,
      createdAt: this.now().toISOString(),
      attempts: 0,
      state: 'pending',
      lastError: null,
    };
    await this.store.put(item);
    this.changed();
    return item;
  }

  async items(): Promise<OutboxItem[]> {
    const all = await this.store.list();
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Remove a failed item once the user has seen it. */
  async dismiss(id: string): Promise<void> {
    await this.store.remove(id);
    this.changed();
  }

  /**
   * Send pending items oldest first. One flush at a time (concurrent calls share it). Stops at the
   * first `retry` so a booking's steps are never sent out of order.
   */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async run(): Promise<FlushResult> {
    let sent = 0;
    let failed = 0;
    for (const item of await this.items()) {
      if (item.state !== 'pending') continue;
      let result: SendResult;
      try {
        result = await this.send(item.op);
      } catch (err) {
        result = 'retry';
        item.lastError = err instanceof Error ? err.message : String(err);
      }
      if (result === 'done') {
        await this.store.remove(item.id);
        sent++;
      } else if (result === 'retry') {
        await this.store.put({ ...item, attempts: item.attempts + 1 });
        break;
      } else {
        await this.store.put({
          ...item,
          attempts: item.attempts + 1,
          state: 'failed',
          lastError: result.failed,
        });
        failed++;
      }
      this.changed();
    }
    const remaining = (await this.store.list()).filter((i) => i.state === 'pending').length;
    return { sent, failed, remaining };
  }

  private changed() {
    for (const l of this.listeners) l();
  }
}

/** In-memory store (tests, and a fallback if the database cannot open). */
export function memoryStore(): OutboxStore {
  const rows = new Map<string, OutboxItem>();
  return {
    list: async () => [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)) as OutboxItem),
    put: async (item) => {
      rows.set(item.id, JSON.parse(JSON.stringify(item)) as OutboxItem);
    },
    remove: async (id) => {
      rows.delete(id);
    },
  };
}
