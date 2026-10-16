import type { BookingStatus } from '@vetlink/shared';
import { Outbox, memoryStore, type OutboxOp } from '../src/offline/outbox';
import { createSender, type SenderApi } from '../src/offline/send';

/**
 * The M12 offline sync test: a vet works a job with no connection, then the connection returns.
 * A fake server applies the booking state machine; the network can be cut at will.
 */
class FakeServer implements SenderApi {
  online = false;
  /** Apply the request but lose the response (the phone dropped off mid-request). */
  loseNextResponse = false;
  status: BookingStatus = 'matched';
  calls: string[] = [];
  completions = 0;
  uploads = 0;

  private async request(label: string, apply: () => { ok: boolean; code?: string }) {
    if (!this.online) throw new TypeError('Network request failed');
    this.calls.push(label);
    const r = apply();
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TypeError('Network request failed');
    }
    return r.ok
      ? { response: { status: 200 } }
      : { error: { code: r.code ?? 'invalid_transition' }, response: { status: 409 } };
  }

  postStatus(_id: number, status: 'en_route' | 'in_service') {
    return this.request(`status:${status}`, () => {
      const from = status === 'en_route' ? 'matched' : 'en_route';
      if (this.status !== from) return { ok: false };
      this.status = status;
      return { ok: true };
    });
  }

  postComplete() {
    return this.request('complete', () => {
      if (this.status !== 'in_service') return { ok: false };
      this.status = 'done';
      this.completions++;
      return { ok: true };
    });
  }

  async getBookingStatus() {
    if (!this.online) throw new TypeError('Network request failed');
    return { response: { status: 200 }, status: this.status };
  }

  uploadDocument() {
    return this.request('upload', () => {
      this.uploads++;
      return { ok: true };
    });
  }
}

const job = 42;
const steps: OutboxOp[] = [
  { kind: 'booking_status', bookingId: job, status: 'en_route' },
  { kind: 'booking_status', bookingId: job, status: 'in_service' },
  {
    kind: 'booking_complete',
    bookingId: job,
    body: { diagnosis: 'East Coast Fever', clientCreatedAt: '2026-10-16T08:00:00.000Z' },
  },
];

function setup() {
  const server = new FakeServer();
  let seq = 0;
  let clock = Date.parse('2026-10-16T08:00:00Z');
  const outbox = new Outbox(
    memoryStore(),
    createSender(server),
    () => `op-${++seq}`,
    () => new Date((clock += 1000)),
  );
  return { server, outbox };
}

describe('offline outbox', () => {
  it('keeps every step while offline, then syncs them in order when the connection returns', async () => {
    const { server, outbox } = setup();
    for (const op of steps) await outbox.enqueue(op);

    // Offline: nothing is lost, nothing is reordered.
    expect(await outbox.flush()).toEqual({ sent: 0, failed: 0, remaining: 3 });
    expect(await outbox.flush()).toEqual({ sent: 0, failed: 0, remaining: 3 });
    const waiting = await outbox.items();
    expect(waiting.map((i) => i.op.kind)).toEqual([
      'booking_status',
      'booking_status',
      'booking_complete',
    ]);
    expect(waiting[0]?.attempts).toBe(2);

    server.online = true;
    expect(await outbox.flush()).toEqual({ sent: 3, failed: 0, remaining: 0 });
    expect(server.calls).toEqual(['status:en_route', 'status:in_service', 'complete']);
    expect(server.status).toBe('done');
    expect(await outbox.items()).toEqual([]);
  });

  it('a lost response is not sent twice: the server already has it, so the item is done', async () => {
    const { server, outbox } = setup();
    for (const op of steps) await outbox.enqueue(op);
    server.online = true;
    server.loseNextResponse = true; // en_route lands, its answer never arrives

    expect(await outbox.flush()).toEqual({ sent: 0, failed: 0, remaining: 3 });
    expect(server.status).toBe('en_route');

    // The resend gets 409; the booking shows the step already happened.
    expect(await outbox.flush()).toEqual({ sent: 3, failed: 0, remaining: 0 });
    expect(server.completions).toBe(1);
  });

  it('the server wins: if the farmer cancelled meanwhile, the steps fail and are shown', async () => {
    const { server, outbox } = setup();
    for (const op of steps) await outbox.enqueue(op);
    server.status = 'cancelled';
    server.online = true;

    expect(await outbox.flush()).toEqual({ sent: 0, failed: 3, remaining: 0 });
    const failed = await outbox.items();
    expect(failed.every((i) => i.state === 'failed' && i.lastError === 'booking_cancelled')).toBe(
      true,
    );
    // Failed items are not resent; the user dismisses them.
    expect(await outbox.flush()).toEqual({ sent: 0, failed: 0, remaining: 0 });
    for (const i of failed) await outbox.dismiss(i.id);
    expect(await outbox.items()).toEqual([]);
  });

  it('concurrent flushes share one run (no double sends)', async () => {
    const { server, outbox } = setup();
    await outbox.enqueue({
      kind: 'document_upload',
      docKind: 'id_front',
      fileUri: 'file:///id.jpg',
      contentType: 'image/jpeg',
      size: 1000,
    });
    server.online = true;
    const [a, b] = await Promise.all([outbox.flush(), outbox.flush()]);
    expect(a).toBe(b);
    expect(server.uploads).toBe(1);
  });

  it('notifies listeners so the "pending sync" badge updates', async () => {
    const { outbox } = setup();
    let changes = 0;
    const stop = outbox.subscribe(() => changes++);
    await outbox.enqueue(steps[0] as OutboxOp);
    stop();
    await outbox.enqueue(steps[1] as OutboxOp);
    expect(changes).toBe(1);
  });
});
