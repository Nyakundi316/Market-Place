import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env.validation';

/** Boots the real AppModule with the production middleware stack. */
export async function createApp(extraControllers: Type[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = configureApp(moduleRef.createNestApplication(), loadEnv());
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
