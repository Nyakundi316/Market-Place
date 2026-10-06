import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorDto } from '@markethub/shared';
import type { Request, Response } from 'express';

/**
 * Single error shape for every failure (ApiErrorDto). Unknown errors become a
 * bare 500 — stack traces and driver messages never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const body = this.toBody(exception);
    body.requestId = req.id?.toString();

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId: body.requestId }, 'Unhandled error');
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorDto {
    if (!(exception instanceof HttpException)) {
      return { statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong' };
    }

    const statusCode = exception.getStatus();
    const raw = exception.getResponse();
    const error = HttpStatus[statusCode]?.replace(/_/g, ' ') ?? 'Error';

    if (typeof raw === 'string') return { statusCode, error, message: raw };

    const { message, fields } = raw as {
      message?: string | string[];
      fields?: Record<string, string[]>;
    };
    return {
      statusCode,
      error,
      message: Array.isArray(message) ? message.join('; ') : (message ?? exception.message),
      ...(fields && { fields }),
    };
  }
}
