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

// Third-party keys pasted by hand. A one-character value (a terminal turned Ctrl+V into
// a control character) once booted fine and only failed at the first upload or payment.
const credential = optional.pipe(
  z
    .string()
    .regex(/^[\x21-\x7e]{8,}$/, 'looks truncated, or has spaces or control characters')
    .optional(),
);

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
  // Documented extra: the web server's anonymous SSR reads all come from one
  // IP; with this header they skip the per-IP global bucket (GET only).
  INTERNAL_API_KEY: secret.optional(),
  JWT_REFRESH_TTL: z.string().regex(DURATION).default('7d'),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,

  S3_ENDPOINT: optional.pipe(z.string().url().optional()),
  S3_BUCKET: optional,
  S3_ACCESS_KEY: credential,
  S3_SECRET_KEY: credential,
  S3_REGION: z.string().default('auto'),
  // Documented extra: where uploaded objects are read from (CDN / R2 public domain).
  // Defaults to path-style ${S3_ENDPOINT}/${S3_BUCKET}, which is what MinIO serves.
  S3_PUBLIC_URL: optional.pipe(z.string().url().optional()),
  // Documented extra: verification documents live here, never publicly readable.
  S3_PRIVATE_BUCKET: optional,

  PAYSTACK_SECRET_KEY: optional.pipe(
    z
      .string()
      .regex(
        /^sk_(test|live)_[A-Za-z0-9]+$/,
        'must be a Paystack secret key (sk_test_… or sk_live_…)',
      )
      .optional(),
  ),
  PAYSTACK_WEBHOOK_SECRET: credential,

  RESEND_API_KEY: credential,
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('MarketHub <no-reply@markethub.local>'),
  // Documented extra (replaces §12 FCM_SERVER_KEY): Web Push. Generate a pair with
  // `npx web-push generate-vapid-keys`. Blank = push off; in-app + email still work.
  // Subject defaults to MAIL_FROM's address as a mailto: link.
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional.pipe(
    z
      .string()
      .regex(/^(mailto:|https:\/\/)/, 'must be a mailto: or https:// URL')
      .optional(),
  ),

  // Documented extra: SMS for phone verification codes. Username "sandbox" talks
  // to Africa's Talking's simulator. Blank = Redis outbox outside production, and
  // phone verification switched off in production.
  AFRICASTALKING_USERNAME: optional,
  AFRICASTALKING_API_KEY: optional,
  AFRICASTALKING_SENDER_ID: optional,

  // Observability (Phase 7): both off unless set. Read by src/instrumentation.ts
  // before validation; declared here so a typo'd URL still fails the boot.
  SENTRY_DSN: optional.pipe(z.string().url().optional()),
  SENTRY_ENVIRONMENT: optional,
  OTEL_EXPORTER_OTLP_ENDPOINT: optional.pipe(z.string().url().optional()),
  OTEL_SERVICE_NAME: optional,
  GIT_SHA: optional,

  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(2),
  ESCROW_AUTO_RELEASE_HOURS: z.coerce.number().int().positive().default(72),
  DISPUTE_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
});

// Keys that may be blank locally but must exist in production.
const REQUIRED_IN_PROD = [
  'INTERNAL_API_KEY',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_PRIVATE_BUCKET',
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

  if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_PRIVATE_KEY'],
      message: 'Web Push needs both VAPID keys',
    });
  }

  if (Boolean(env.AFRICASTALKING_USERNAME) !== Boolean(env.AFRICASTALKING_API_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AFRICASTALKING_API_KEY'],
      message: "Africa's Talking needs both username and API key",
    });
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
