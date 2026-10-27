import type { BookingStatus } from '@vetlink/shared';
import type { OutboxOp, SendResult } from './outbox';

/** The slice of the typed API client the sender needs (a stub in tests). */
interface Result {
  error?: { code?: string } | undefined;
  response: { status: number };
}
export interface SenderApi {
  postStatus(bookingId: number, status: 'en_route' | 'in_service'): Promise<Result>;
  postComplete(
    bookingId: number,
    body: Extract<OutboxOp, { kind: 'booking_complete' }>['body'],
  ): Promise<Result>;
  getBookingStatus(bookingId: number): Promise<Result & { status?: BookingStatus }>;
  uploadDocument(op: Extract<OutboxOp, { kind: 'document_upload' }>): Promise<Result>;
}

const PROGRESS: readonly BookingStatus[] = [
  'pending_payment',
  'pending',
  'matched',
  'en_route',
  'in_service',
  'done',
];

/** Network trouble, rate limits, server errors and an expired session are worth retrying. */
function transient(status: number): boolean {
  return status >= 500 || status === 408 || status === 429 || status === 401;
}

export function createSender(api: SenderApi): (op: OutboxOp) => Promise<SendResult> {
  /**
   * After a 409 the booking decides: if it already reached `target` (our earlier send landed but
   * its response was lost), the item is done; if it moved elsewhere (cancelled, reassigned), the
   * server wins and the item fails.
   */
  async function reached(bookingId: number, target: BookingStatus): Promise<SendResult> {
    const res = await api.getBookingStatus(bookingId);
    if (res.error || !res.status)
      return transient(res.response.status) ? 'retry' : { failed: res.error?.code ?? 'not_found' };
    const at = PROGRESS.indexOf(res.status);
    return at >= 0 && at >= PROGRESS.indexOf(target) ? 'done' : { failed: `booking_${res.status}` };
  }

  async function settle(
    res: Result,
    bookingId: number,
    target: BookingStatus,
  ): Promise<SendResult> {
    if (!res.error) return 'done';
    if (transient(res.response.status)) return 'retry';
    if (res.error.code === 'invalid_transition') return reached(bookingId, target);
    return { failed: res.error.code ?? `http_${res.response.status}` };
  }

  return async (op) => {
    switch (op.kind) {
      case 'booking_status':
        return settle(await api.postStatus(op.bookingId, op.status), op.bookingId, op.status);
      case 'booking_complete':
        return settle(await api.postComplete(op.bookingId, op.body), op.bookingId, 'done');
      case 'document_upload': {
        const res = await api.uploadDocument(op);
        if (!res.error) return 'done';
        return transient(res.response.status)
          ? 'retry'
          : { failed: res.error.code ?? `http_${res.response.status}` };
      }
    }
  };
}
