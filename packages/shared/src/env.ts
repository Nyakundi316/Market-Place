import { z } from 'zod';

// "15m", "7d", "3600s" → seconds. Kept here so API and tests agree on the format.
const DURATION = /^(\d+)(s|m|h|d)$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export function durationToSeconds(value: string): number {
  const match = DURATION.exec(value);
  if (!match) throw new Error(`Invalid duration "${value}" (expected e.g. 15m, 7d)`);
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const secret = z.string().min(32, 'must be at least 32 characters (§9)');

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url(),
  API_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_TTL: z.string().regex(DURATION).default('15m'),
  JWT_REFRESH_TTL: z.string().regex(DURATION).default('7d'),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,

  S3_ENDPOINT: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY: optional,
  S3_SECRET_KEY: optional,
  S3_REGION: z.string().default('auto'),

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_CONNECT_CLIENT_ID: optional,
  PAYSTACK_SECRET_KEY: optional,
  PAYSTACK_WEBHOOK_SECRET: optional,

  RESEND_API_KEY: optional,
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('MarketHub <no-reply@markethub.local>'),
  FCM_SERVER_KEY: optional,

  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(2),
  ESCROW_AUTO_RELEASE_HOURS: z.coerce.number().int().positive().default(72),
  DISPUTE_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
});

// Keys that may be blank locally but must exist in production.
const REQUIRED_IN_PROD = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_WEBHOOK_SECRET',
  'RESEND_API_KEY',
] as const;

export const envSchema = base.superRefine((env, ctx) => {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_REFRESH_SECRET'],
      message: 'must differ from JWT_ACCESS_SECRET',
    });
  }

  // An OAuth provider is either fully configured or fully off.
  for (const p of ['GOOGLE', 'GITHUB'] as const) {
    if (Boolean(env[`${p}_CLIENT_ID`]) !== Boolean(env[`${p}_CLIENT_SECRET`])) {
      ctx.addIssue({
        code: 'custom',
        path: [`${p}_CLIENT_SECRET`],
        message: `${p} OAuth needs both id and secret`,
      });
    }
  }

  if (env.NODE_ENV !== 'production') return;
  for (const key of REQUIRED_IN_PROD) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
  }
  if (!env.WEB_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEB_URL'],
      message: 'must be https in production (§7)',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Throws one readable error listing every bad key — never echoes values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join('\n')}`);
}
