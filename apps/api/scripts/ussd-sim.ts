/**
 * Local USSD simulator (`pnpm ussd:sim`): talks to the running API exactly like Africa's
 * Talking does, so the farmer flow can be tried without a phone network.
 *
 *   pnpm ussd:sim                      # as the seeded demo farmer (0700000001)
 *   pnpm ussd:sim -- --phone 0712345678
 *   pnpm ussd:sim -- --url http://localhost:4000
 *
 * Reads WEBHOOK_SECRET from the environment (the root .env) when it is set.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    phone: { type: 'string', default: '0700000001' },
    url: { type: 'string', default: 'http://localhost:4000' },
  },
});

const out = (s: string) => process.stdout.write(`${s}\n`);
const rl = createInterface({ input: process.stdin });
// Iterating lines (rather than `question`) also works when input is piped in from a script.
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const next = await lines.next();
  if (next.done) {
    out('');
    process.exit(0);
  }
  return String(next.value).trim();
}

async function post(sessionId: string, text: string): Promise<string> {
  const url = new URL('/webhooks/ussd', values.url);
  if (process.env.WEBHOOK_SECRET) url.searchParams.set('token', process.env.WEBHOOK_SECRET);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      sessionId,
      serviceCode: '*123#',
      phoneNumber: values.phone,
      networkCode: '63902',
      text,
    }),
  });
  if (!res.ok) throw new Error(`API answered ${res.status}: ${await res.text()}`);
  return res.text();
}

out(`Dialling *123# as ${values.phone} (Ctrl+C to quit)\n`);
for (;;) {
  const sessionId = `SIM_${randomUUID()}`;
  const inputs: string[] = [];
  for (;;) {
    const reply = await post(sessionId, inputs.join('*'));
    const [kind, ...rest] = reply.split(' ');
    out(`┌${'─'.repeat(30)}\n${rest.join(' ')}\n└${'─'.repeat(30)} (${reply.length} chars)`);
    if (kind === 'END') break;
    inputs.push(await ask('> '));
  }
  const again = await ask('\nSession ended. Dial again? [Y/n] ');
  if (again.toLowerCase().startsWith('n')) break;
}
rl.close();
