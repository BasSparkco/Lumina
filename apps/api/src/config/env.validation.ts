import { z } from 'zod';

// Every var a consumer actually reads today, either via ConfigService.get/getOrThrow or (for the
// handful read directly, e.g. main.ts's PORT/HOST) plain process.env — see grep results in the
// audit that motivated this file. Centralizing the shape here means a missing/malformed required
// var fails loudly at boot (ConfigModule.forRoot's `validate` throws before Nest ever calls
// app.listen()), not deep inside Prisma/S3/JWT the first time a request happens to need it.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // 16 chars is a floor, not a real strength check — this is a "did someone leave the .env.example
  // placeholder in place" tripwire, not a substitute for a real secret-strength policy.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY is required'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  CDN_BASE_URL: z.string().min(1, 'CDN_BASE_URL is required'),

  // Deliberately optional here, not required — main.ts already has its own explicit fail-closed
  // behavior (CORS rejects all origins, with a loud warning) when both are unset. Requiring them
  // here would just move that same decision to a less specific error message.
  DASHBOARD_URL: z.string().optional(),
  PLAYER_URL: z.string().optional(),

  // Optional — the stock-photo picker (assets/stock/*) just reports itself unconfigured and
  // the dashboard shows a setup hint when this is unset, same "degrade, don't fail boot" pattern.
  PEXELS_API_KEY: z.string().optional(),

  // The production business flow is Super-Admin-provisioned tenants (see the platform-tenants
  // module), so this defaults closed. Set true for local dev/testing or a future self-service
  // plan — see docs/adr/platform-modules-and-entitlements.md.
  //
  // Deliberately not z.coerce.boolean(): that coerces via JS `Boolean(value)`, and env vars are
  // always strings — `Boolean("false")` is `true`, since "false" is a non-empty string. That
  // would make ALLOW_SELF_REGISTRATION=false in the environment silently mean "enabled," which
  // defeats the entire point of this flag. Only the literal string "true" turns it on.
  ALLOW_SELF_REGISTRATION: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // Bounds how long a player may keep rendering a paid module's content from a cached/offline
  // snapshot after its last successful live fetch (PlayerService.getState()'s module lease —
  // see docs/adr/platform-modules-and-entitlements.md). Read directly from process.env in
  // PlayerService, not via ConfigService.get(), for the same reason ALLOW_SELF_REGISTRATION is:
  // ConfigModule.forRoot's `load` factory shadows this validated value with the raw string.
  // This entry exists so a malformed value still fails loudly at boot.
  PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS: z.coerce.number().int().positive().default(168),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
