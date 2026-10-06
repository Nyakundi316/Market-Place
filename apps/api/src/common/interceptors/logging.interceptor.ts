import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { tap, type Observable } from 'rxjs';

/**
 * pino-http already logs every request line. This adds which handler ran and
 * who called it, which is what you actually want when tracing a bug.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext('Handler');
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const handler = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const userId = ctx.switchToHttp().getRequest<{ user?: { id: string } }>().user?.id;
    const started = performance.now();

    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.debug({ handler, userId, ms: Math.round(performance.now() - started) }),
        ),
      );
  }
}
