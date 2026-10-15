import type { PushMessage, PushSender, PushTicket } from '../../src/modules/notifications/push.js';

/** Records pushes; tokens in `unregistered` answer DeviceNotRegistered; `down` fails the call. */
export class FakePush implements PushSender {
  sent: PushMessage[] = [];
  unregistered = new Set<string>();
  down = false;
  private seq = 0;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.down) throw new Error('fake: Expo unavailable');
    return messages.map((m) => {
      if (this.unregistered.has(m.to)) return { ok: false, error: 'DeviceNotRegistered' };
      this.sent.push(m);
      this.seq += 1;
      return { ok: true, id: `ticket-${this.seq}` };
    });
  }

  to(token: string): PushMessage[] {
    return this.sent.filter((m) => m.to === token);
  }
}
