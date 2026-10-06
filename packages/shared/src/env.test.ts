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

  it('requires payment, storage and mail keys plus https in production', () => {
    let message = '';
    try {
      parseEnv({ ...valid, NODE_ENV: 'production' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/STRIPE_SECRET_KEY: required in production/);
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
