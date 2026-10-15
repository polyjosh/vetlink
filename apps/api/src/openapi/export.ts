import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app.js';
import type { AppContext } from '../context.js';

/**
 * Write the OpenAPI document (`pnpm api:generate`). Builds the app without a database: the
 * context is a stand-in that throws if anything touches it, since only route registration runs.
 */
export async function exportOpenApi(): Promise<string> {
  const ctx = new Proxy({} as AppContext, {
    get(_target, prop) {
      throw new Error(`AppContext.${String(prop)} used while exporting OpenAPI`);
    },
  });
  const app = buildApp({ logLevel: 'silent', deps: [], ctx });
  await app.ready();
  const doc = JSON.stringify(app.swagger(), null, 2) + '\n';
  await app.close();
  return doc;
}

const target = process.argv[2];
if (target) {
  writeFileSync(resolve(target), await exportOpenApi());
}
