import { Injectable, Logger } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import type Redis from 'ioredis';
import { InjectEnv } from '../../config/env.validation';
import { InjectRedis } from '../../redis/redis.module';

export const smsOutboxKey = (phone: string) => `sms:outbox:${phone}`;

/**
 * Phone codes go out through here. No SMS provider is part of the stack yet
 * (§1), so outside production messages land in a Redis outbox (and the log)
 * that dev and tests read; in production phone verification reports itself
 * unavailable until a provider is wired in behind `send`.
 */
@Injectable()
export class SmsSender {
  private readonly logger = new Logger(SmsSender.name);

  constructor(
    @InjectEnv() private readonly env: Env,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  get available() {
    return this.env.NODE_ENV !== 'production';
  }

  async send(phone: string, text: string): Promise<void> {
    if (!this.available) throw new Error('No SMS provider configured');
    await this.redis
      .multi()
      .lpush(smsOutboxKey(phone), text)
      .expire(smsOutboxKey(phone), 3600)
      .exec();
    if (this.env.NODE_ENV === 'development') this.logger.log(`SMS to ${phone}: ${text}`);
  }
}
