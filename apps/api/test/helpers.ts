import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.module';

/** Boots the real AppModule with the production middleware stack. */
export async function createApp(extraControllers: Type[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ rawBody: true }), loadEnv());
  await app.init();
  return app;
}

/** Wipes rate-limit buckets in the *test* Redis DB so suites don't throttle each other. */
export async function resetRateLimits() {
  const url = process.env.REDIS_URL!;
  if (!/\/1$/.test(url)) throw new Error(`Refusing to flush non-test Redis: ${url}`);
  const redis = new Redis(url);
  await redis.flushdb();
  await redis.quit();
}

/** Cookie name to value, from a response's Set-Cookie headers. */
export function cookiesFrom(res: { headers: Record<string, unknown> }): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  return Object.fromEntries(
    list.map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  );
}

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;

interface MailhogItem {
  Content: { Headers: { Subject: string[] }; Body: string };
}

/**
 * Polls Mailhog for the newest message to `to` and returns subject + the
 * token from its link. Bodies are quoted-printable, so undo soft line breaks
 * and `=3D` before matching.
 */
export async function mailTo(to: string, subject: RegExp, timeoutMs = 5000) {
  const url = `http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(to)}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = (await (await fetch(url)).json()) as { items: MailhogItem[] };
    const hit = items.find((m) => subject.test(m.Content.Headers.Subject[0] ?? ''));
    if (hit) {
      const body = hit.Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
      return { subject: hit.Content.Headers.Subject[0]!, token: /token=([\w-]+)/.exec(body)?.[1] };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

export interface TestUser {
  id: string;
  auth: string;
  username: string;
  email: string;
}

/**
 * Registers through the real endpoint, then shortcuts the slow parts (email
 * verification, onboarding, admin promotion) straight in the DB.
 */
export async function makeUser(
  app: INestApplication,
  opts: {
    role?: 'buyer' | 'seller' | 'both' | 'admin';
    verified?: boolean;
    profile?: boolean;
  } = {},
): Promise<TestUser> {
  const { role = 'both', verified = true, profile = true } = opts;
  const email = uniqueEmail(role);
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'correct horse battery' });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.user.id as string;
  const username = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const db = app.get(PrismaService);
  await db.user.update({
    where: { id },
    data: {
      role,
      isEmailVerified: verified,
      ...(profile && {
        profile: {
          create: { displayName: `Test ${username}`, username, country: 'KE', city: 'Nairobi' },
        },
      }),
    },
  });
  return { id, auth: `Bearer ${res.body.accessToken}`, username, email };
}

// 1×1 transparent PNG
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Signs and actually PUTs a tiny PNG; returns the public URL. */
export async function uploadPng(
  app: INestApplication,
  user: TestUser,
  purpose: 'listing' | 'avatar' | 'chat' = 'listing',
) {
  const signed = await request(app.getHttpServer())
    .post('/images/sign')
    .set('Authorization', user.auth)
    .send({ purpose, contentType: 'image/png', size: PNG.length })
    .expect(201);
  const put = await fetch(signed.body.uploadUrl, {
    method: 'PUT',
    body: PNG,
    headers: { 'Content-Type': 'image/png' },
  });
  if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
  return signed.body.publicUrl as string;
}
