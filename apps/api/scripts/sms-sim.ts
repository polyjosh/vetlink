/**
 * Local SMS simulator (`pnpm --filter api sms:sim`): sends one inbound SMS to the running API the
 * way Africa's Talking does, and prints the reply (SMS_MODE=log returns it in the response).
 *
 *   pnpm --filter api sms:sim -- --phone 0700000002 "Y4"
 *   pnpm --filter api sms:sim -- --phone 0700000002 "DONE 4 ECF; oxytet 20ml; f/u 7d"
 *   pnpm --filter api sms:sim -- --phone 0700000001 "R4 5"
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

// `pnpm … sim -- --phone …` passes the `--` through; drop it so the options are seen.
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    phone: { type: 'string', default: '0700000002' },
    url: { type: 'string', default: 'http://localhost:4000' },
  },
});
const message = positionals.join(' ');
const url = new URL('/webhooks/sms', values.url);
if (process.env.WEBHOOK_SECRET) url.searchParams.set('token', process.env.WEBHOOK_SECRET);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    from: values.phone,
    text: message,
    id: `SIM-${randomUUID()}`,
    to: '20880',
  }),
});
const out = (s: string) => process.stdout.write(`${s}\n`);
if (!res.ok) {
  out(`API answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const body = (await res.json()) as { reply?: string | null };
out(`> ${message}`);
out(
  body.reply === undefined
    ? '(reply sent as SMS; set SMS_MODE=log to see it here)'
    : `< ${body.reply ?? '(no reply)'}`,
);
