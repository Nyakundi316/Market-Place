import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env.validation';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication(), loadEnv());
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /health → 200 with security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('unknown route → 404 in ApiErrorDto shape', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT FOUND' });
    expect(res.body.requestId).toBeDefined();
  });

  it('CORS allows only WEB_URL', async () => {
    const ok = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('ignores a spoofed non-uuid x-request-id', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('x-request-id', '<script>');
    expect(res.headers['x-request-id']).not.toBe('<script>');
  });
});
