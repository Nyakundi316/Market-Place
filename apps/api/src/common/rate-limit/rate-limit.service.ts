import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectRedis } from '../../redis/redis.module';

export interface Policy {
  /** bucket size = requests allowed in a burst */
  capacity: number;
  /** time to refill the whole bucket */
  windowMs: number;
  /** when Redis is unreachable: true = block (money), false = allow */
  failClosed?: boolean;
}

// §9 rate limits
export const POLICIES = {
  global: { capacity: 100, windowMs: 60_000 },
  auth: { capacity: 10, windowMs: 60_000 },
  payment: { capacity: 5, windowMs: 60_000, failClosed: true },
  messages: { capacity: 20, windowMs: 10_000 },
} satisfies Record<string, Policy>;

export type PolicyName = keyof typeof POLICIES;

export interface Verdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// Token bucket. Uses Redis TIME so app-server clock skew can't widen the window.
// Returns {allowed(0|1), tokensLeft, retryAfterMs}.
const TOKEN_BUCKET = `
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local t    = redis.call('TIME')
local now  = t[1] * 1000 + math.floor(t[2] / 1000)
local b    = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts     = tonumber(b[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate))
local wait = 0
if allowed == 0 then wait = math.ceil((1 - tokens) / rate) end
return { allowed, math.floor(tokens), wait }
`;

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async consume(key: string, policy: Policy): Promise<Verdict> {
    try {
      const [allowed, remaining, retryAfterMs] = (await this.redis.eval(
        TOKEN_BUCKET,
        1,
        `rl:${key}`,
        policy.capacity,
        policy.capacity / policy.windowMs,
      )) as [number, number, number];
      return { allowed: allowed === 1, remaining, retryAfterMs };
    } catch (err) {
      this.logger.error({ err, key }, 'Rate limiter unavailable');
      return {
        allowed: !policy.failClosed,
        remaining: 0,
        retryAfterMs: policy.failClosed ? 1000 : 0,
      };
    }
  }
}
