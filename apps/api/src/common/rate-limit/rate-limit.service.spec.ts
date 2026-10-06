import type Redis from 'ioredis';
import { POLICIES, RateLimitService } from './rate-limit.service';

describe('RateLimitService when Redis is down', () => {
  const broken = {
    eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  } as unknown as Redis;
  const limiter = new RateLimitService(broken);

  it('fails open for general traffic', async () => {
    expect((await limiter.consume('k', POLICIES.global)).allowed).toBe(true);
  });

  it('fails closed for payments (§7)', async () => {
    const verdict = await limiter.consume('k', POLICIES.payment);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBeGreaterThan(0);
  });
});
