import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { InjectRedis } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  // Postgres check joins once PrismaModule lands (1.8).
  @Public()
  @Get()
  async check() {
    const redis = await this.redis.ping().then(
      () => 'up' as const,
      () => 'down' as const,
    );
    if (redis === 'down') throw new ServiceUnavailableException({ message: 'Redis unreachable' });
    return { status: 'ok', uptime: Math.round(process.uptime()), redis };
  }
}
