import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { appConfig } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';

/**
 * Settings an admin can change at runtime (§8.5: "weights live in config, not in code").
 * Defaults and validation live here; `app_config` rows override single keys.
 */
const weights = z
  .object({
    proximity: z.number().min(0).max(1),
    specialty: z.number().min(0).max(1),
    acceptance: z.number().min(0).max(1),
    rating: z.number().min(0).max(1),
    fairness: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 0.001, {
    message: 'weights must add up to 1',
  });

export const CONFIG_SCHEMAS = {
  /** Score weights (§8.5). */
  'matching.weights': weights,
  /** Farthest a vet is ever offered a job, in km (rural default; urban may set lower). */
  'matching.maxRadiusKm': z.number().min(1).max(200),
  /** Vets per wave; later waves reuse the last size. */
  'matching.waveSizes': z.array(z.number().int().min(1).max(50)).min(1).max(10),
  /** From wave 3 on, the radius grows by this factor (§8.5: +50%). */
  'matching.wideWaveRadiusFactor': z.number().min(1).max(5),
  /** Jobs a vet can hold at once before no more offers are sent. */
  'matching.maxActiveJobs': z.number().int().min(1).max(10),
  /** After the last wave finds nobody, how long to keep searching before cancelling. */
  'matching.giveUpAfterMinutes': z.number().int().min(1).max(240),
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMAS;
export type ConfigValue<K extends ConfigKey> = z.infer<(typeof CONFIG_SCHEMAS)[K]>;

export const CONFIG_DEFAULTS: { [K in ConfigKey]: ConfigValue<K> } = {
  'matching.weights': {
    proximity: 0.4,
    specialty: 0.2,
    acceptance: 0.2,
    rating: 0.1,
    fairness: 0.1,
  },
  'matching.maxRadiusKm': 25,
  'matching.waveSizes': [3, 3, 5],
  'matching.wideWaveRadiusFactor': 1.5,
  'matching.maxActiveJobs': 1,
  'matching.giveUpAfterMinutes': 10,
};

export const CONFIG_KEYS = Object.keys(CONFIG_SCHEMAS) as ConfigKey[];

export async function getConfig<K extends ConfigKey>(
  ctx: Pick<AppContext, 'db'>,
  key: K,
): Promise<ConfigValue<K>> {
  const [row] = await ctx.db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
  if (!row) return CONFIG_DEFAULTS[key];
  // A stored value that no longer validates (schema changed) falls back to the default.
  const parsed = CONFIG_SCHEMAS[key].safeParse(row.value);
  return parsed.success ? (parsed.data as ConfigValue<K>) : CONFIG_DEFAULTS[key];
}

export async function allConfig(ctx: Pick<AppContext, 'db'>) {
  const rows = await ctx.db.select().from(appConfig);
  const overrides = new Map(rows.map((r) => [r.key, r]));
  return CONFIG_KEYS.map((key) => ({
    key,
    value: (overrides.has(key) ? overrides.get(key)?.value : CONFIG_DEFAULTS[key]) as unknown,
    isDefault: !overrides.has(key),
    updatedAt: overrides.get(key)?.updatedAt.toISOString() ?? null,
  }));
}

export async function setConfig(
  ctx: AppContext,
  key: string,
  value: unknown,
  adminUserId: string,
): Promise<void> {
  if (!(key in CONFIG_SCHEMAS)) throw new DomainError('not_found');
  const parsed = CONFIG_SCHEMAS[key as ConfigKey].safeParse(value);
  if (!parsed.success) {
    throw new DomainError('invalid_request', {
      fields: parsed.error.issues.map((i) => ['value', ...i.path].join('.')),
    });
  }
  const now = ctx.clock();
  await ctx.db
    .insert(appConfig)
    .values({ key, value: parsed.data, updatedBy: adminUserId, updatedAt: now })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: parsed.data, updatedBy: adminUserId, updatedAt: now },
    });
}
