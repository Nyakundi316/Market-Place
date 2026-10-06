import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  // DB + Redis checks join this once those modules exist (1.4, 1.7).
  @Public()
  @Get()
  check() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
