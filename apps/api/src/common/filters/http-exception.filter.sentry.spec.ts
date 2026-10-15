import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { HttpExceptionFilter } from './http-exception.filter';

jest.mock('../../instrumentation', () => ({ sentryEnabled: true }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const host = {
  switchToHttp: () => ({
    getResponse: () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }),
    getRequest: () => ({ id: 'req-9', route: { path: '/orders/:id/pay' } }),
  }),
} as unknown as ArgumentsHost;

describe('HttpExceptionFilter → Sentry', () => {
  beforeEach(() => jest.mocked(Sentry.captureException).mockClear());

  it('reports server errors with the request id and route', () => {
    const boom = new Error('db exploded');
    new HttpExceptionFilter().catch(boom, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { requestId: 'req-9', route: '/orders/:id/pay' },
    });
  });

  it('leaves client errors alone', () => {
    new HttpExceptionFilter().catch(new BadRequestException('nope'), host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
