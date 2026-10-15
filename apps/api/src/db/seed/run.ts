import { z } from 'zod';
import { APP_ENVS } from '@vetlink/shared';
import { fieldCrypto } from '../../lib/crypto.js';
import { maskPhone } from '../../lib/phone.js';
import { createDb } from '../client.js';
import { SEED_ADMIN_TOTP_SECRET, SEED_USERS } from './fixtures.js';
import { assertSeedAllowed, seed } from './seed.js';

// Entry point for `pnpm --filter api db:seed` (runs on the host, reads the repo-root .env).
const env = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    DATABASE_URL: z.url(),
    DATA_ENCRYPTION_KEY: z.string().min(1),
  })
  .safeParse(process.env);
if (!env.success) {
  const fields = env.error.issues.map((i) => i.path.join('.')).join(', ');
  process.stderr.write(`Seed: missing or invalid environment: ${fields}\n`);
  process.exit(1);
}

const { db, close } = createDb(env.data.DATABASE_URL, { max: 1 });
try {
  assertSeedAllowed(env.data.APP_ENV);
  const summary = await seed(db, fieldCrypto(env.data.DATA_ENCRYPTION_KEY));
  const issuer = encodeURIComponent('VetLink (dev)');
  const totpUri = `otpauth://totp/${issuer}:admin?secret=${SEED_ADMIN_TOTP_SECRET}&issuer=${issuer}`;
  process.stdout.write(
    [
      `Seeded ${summary.wards} Kiambu wards and ${summary.users} demo users:`,
      `  farmer        ${maskPhone(SEED_USERS.farmer.phone)}`,
      `  approved vet  ${maskPhone(SEED_USERS.approvedVet.phone)}`,
      `  pending vet   ${maskPhone(SEED_USERS.pendingVet.phone)}  (application submitted)`,
      `  super admin   ${maskPhone(SEED_USERS.admin.phone)}`,
      '  Full demo numbers: apps/api/src/db/seed/fixtures.ts',
      `Admin TOTP secret (dev only): ${SEED_ADMIN_TOTP_SECRET}`,
      `  Authenticator URI: ${totpUri}`,
      '',
    ].join('\n'),
  );
} catch (err) {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
