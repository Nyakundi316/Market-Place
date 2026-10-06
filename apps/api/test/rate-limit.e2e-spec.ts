import { Controller, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Public } from '../src/common/decorators/public.decorator';
import { RateLimit } from '../src/common/rate-limit/rate-limit.guard';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service';
import { loadEnv } from '../src/config/env.validation';
import { resetRateLimits } from './helpers';

@Controller('probe')
class ProbeController {
  @Public()
  @RateLimit('auth')
  @Post('login')
  login() {
    return { ok: true };
  }
}

describe('rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = configureApp(moduleRef.createNestApplication(), loadEnv());
    await app.init();
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  it('auth routes: 10/min per IP, then 429 with Retry-After (§9)', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 10; i++) await request(server).post('/probe/login').expect(201);

    const blocked = await request(server).post('/probe/login').expect(429);
    expect(blocked.body).toMatchObject({
      statusCode: 429,
      message: 'Too many requests, slow down',
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.headers['ratelimit-limit']).toBe('10');
  });

  it('auth bucket does not throttle other routes', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 11; i++) await request(server).post('/probe/login');
    await request(server).get('/health').expect(200);
  });

  it('global: 100/min per caller', async () => {
    const server = app.getHttpServer();
    const results = await Promise.all(
      Array.from({ length: 101 }, () =>
        request(server)
          .get('/health')
          .then((r) => r.status),
      ),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(100);
    expect(results.filter((s) => s === 429)).toHaveLength(1);
  });

  it('token bucket refills over time', async () => {
    const limiter = app.get(RateLimitService);
    const policy = { capacity: 2, windowMs: 200 };
    expect((await limiter.consume('refill', policy)).allowed).toBe(true);
    expect((await limiter.consume('refill', policy)).allowed).toBe(true);
    const denied = await limiter.consume('refill', policy);
    expect(denied).toMatchObject({ allowed: false });
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 130));
    expect((await limiter.consume('refill', policy)).allowed).toBe(true);
  });
});
