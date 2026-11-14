import { z } from 'zod';

/** Running as a Vercel Function (read-only disk, 4.5 MB request limit, many short-lived instances). */
export const onVercel = !!process.env.VERCEL;

/** Vercel exposes the production domain without a scheme. */
const vercelAppUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** On Vercel the platform's PORT always wins (a copied API_PORT=4000 must not override it). */
  API_PORT: z.coerce
    .number()
    .int()
    .default(4000)
    .transform((v) => (onVercel && process.env.PORT ? Number(process.env.PORT) : v)),
  APP_URL: z.url().default(vercelAppUrl ?? 'http://localhost:3000'),
  DATABASE_URL: z.string().trim().min(1),
  DATABASE_ADMIN_URL: z.string().trim().min(1).optional(),
  /** Connections per API instance. Serverless runs many instances, so keep it small there. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(onVercel ? 3 : 20),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  DATA_HMAC_SECRET: z.string().min(32, 'DATA_HMAC_SECRET must be at least 32 characters'),
  /** SEC-05: 32-byte base64 key for field encryption. Optional – derived from DATA_HMAC_SECRET when unset. Never change it once data exists. */
  DATA_ENCRYPTION_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Where uploaded files live: "disk" (STORAGE_DIR) or "db" (inside Postgres). Vercel's disk is read-only and per-instance, so it defaults to "db". */
  STORAGE_DRIVER: z.enum(['disk', 'db']).default(onVercel ? 'db' : 'disk'),
  STORAGE_DIR: z.string().default('./storage'),
  /** Vercel rejects request bodies over 4.5 MB before they reach the API. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(onVercel ? 4 : 10),
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('HRMS <no-reply@hrms.local>'),
  ENABLE_SCHEDULER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Fail fast on bad configuration: the process refuses to start with weak or missing secrets. */
export function config(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    const where = onVercel
      ? 'Set these in Vercel → Project → Settings → Environment Variables (the repo .env is not deployed), then redeploy.'
      : 'Check the .env file in the repository root (run "npm run setup" to create one).';
    throw new Error(`Invalid environment configuration:\n${issues}\n${where}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  cached = parsed.data;
  return cached;
}
