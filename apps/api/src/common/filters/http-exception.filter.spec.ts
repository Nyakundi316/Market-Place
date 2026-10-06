import { BadRequestException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe('HttpExceptionFilter', () => {
  it('shapes HttpExceptions as ApiErrorDto', () => {
    expect(run(new NotFoundException('Listing not found'))).toEqual({
      status: 404,
      body: {
        statusCode: 404,
        error: 'NOT FOUND',
        message: 'Listing not found',
        requestId: 'req-1',
      },
    });
  });

  it('keeps field errors from validation', () => {
    const { body } = run(
      new BadRequestException({ message: 'Validation failed', fields: { email: ['Invalid'] } }),
    );
    expect(body.fields).toEqual({ email: ['Invalid'] });
  });

  it('hides internals of unknown errors', () => {
    const { status, body } = run(new Error('relation "users" does not exist'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('relation');
  });
});
