import { describe, expect, it } from 'vitest';
import { durationToSeconds, parseEnv } from './env';

const valid = {
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseEnv', () => {
  it('applies §12 defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.PLATFORM_FEE_PERCENT).toBe(2);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('rejects short or identical JWT secrets without echoing them', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(
      /must differ/,
    );
    try {
      parseEnv({ ...valid, JWT_ACCESS_SECRET: 'leakme' });
    } catch (e) {
      expect(String(e)).not.toContain('leakme');
    }
  });

  it('rejects half-configured OAuth', () => {
    expect(() => parseEnv({ ...valid, GITHUB_CLIENT_ID: 'x' })).toThrow(/GITHUB OAuth/);
  });

  it('rejects half a VAPID pair and subjects push services would refuse', () => {
    expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: 'BPub' })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() =>
      parseEnv({
        ...valid,
        VAPID_PUBLIC_KEY: 'BPub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'support@markethub.co',
      }),
    ).toThrow(/VAPID_SUBJECT/);
  });

  it("rejects half-configured Africa's Talking", () => {
    expect(() => parseEnv({ ...valid, AFRICASTALKING_USERNAME: 'sandbox' })).toThrow(
      /AFRICASTALKING_API_KEY/,
    );
    expect(
      parseEnv({ ...valid, AFRICASTALKING_USERNAME: 'sandbox', AFRICASTALKING_API_KEY: 'k' })
        .AFRICASTALKING_SENDER_ID,
    ).toBeUndefined();
  });

  it('refuses hand-pasted keys that are clearly broken', () => {
    const issues = (extra: Record<string, string>) => {
      try {
        parseEnv({ ...valid, ...extra });
        return '';
      } catch (e) {
        return String(e);
      }
    };
    // What a Ctrl+V into PowerShell Read-Host actually stored: one control character.
    expect(issues({ S3_ACCESS_KEY: '' })).toMatch(/S3_ACCESS_KEY: looks truncated/);
    expect(issues({ S3_SECRET_KEY: 'x' })).toMatch(/S3_SECRET_KEY: looks truncated/);
    expect(issues({ S3_ENDPOINT: 'x' })).toMatch(/S3_ENDPOINT/);
    expect(issues({ PAYSTACK_SECRET_KEY: 'x' })).toMatch(/PAYSTACK_SECRET_KEY: must be a Paystack/);
    expect(issues({ RESEND_API_KEY: 're_ abc def' })).toMatch(/RESEND_API_KEY/);
    expect(
      issues({
        S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
        S3_ACCESS_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f',
        PAYSTACK_SECRET_KEY: 'sk_test_0123456789abcdef',
        PAYSTACK_WEBHOOK_SECRET: 'sk_test_0123456789abcdef',
      }),
    ).toBe('');
  });

  it('requires payment, storage and mail keys plus https in production', () => {
    let message = '';
    try {
      parseEnv({ ...valid, NODE_ENV: 'production' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/PAYSTACK_SECRET_KEY: required in production/);
    expect(message).toMatch(/RESEND_API_KEY/);
    expect(message).toMatch(/WEB_URL: must be https/);
  });
});

describe('durationToSeconds', () => {
  it('parses units', () => {
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('7d')).toBe(604800);
  });
  it('throws on garbage', () => {
    expect(() => durationToSeconds('7 days')).toThrow();
  });
});
