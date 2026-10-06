import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import Redis from 'ioredis';
import { ENV } from '../config/env.validation';

export const REDIS = Symbol('REDIS');
export const InjectRedis = () => Inject(REDIS);

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const redis = new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 2,
          // Commands fail fast while disconnected instead of queueing forever...
          enableOfflineQueue: false,
          lazyConnect: true,
        });
        // ...so boot waits for the first connection; no Redis = app doesn't start.
        await redis.connect();
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
