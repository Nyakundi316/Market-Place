import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.module';
import { InjectRedis } from '../redis/redis.module';

const probe = (p: Promise<unknown>) =>
  p.then(
    () => 'up' as const,
    () => 'down' as const,
  );

@Controller('health')
export class HealthController {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly db: PrismaService,
  ) {}

  @Public()
  @Get()
  async check() {
    const [redis, postgres] = await Promise.all([
      probe(this.redis.ping()),
      probe(this.db.$queryRaw`SELECT 1`),
    ]);
    if (redis === 'down' || postgres === 'down') {
      throw new ServiceUnavailableException({ message: `redis=${redis} postgres=${postgres}` });
    }
    return { status: 'ok', uptime: Math.round(process.uptime()), redis, postgres };
  }
}
