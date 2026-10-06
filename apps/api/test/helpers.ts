import Redis from 'ioredis';

/** Wipes rate-limit buckets in the *test* Redis DB so suites don't throttle each other. */
export async function resetRateLimits() {
  const url = process.env.REDIS_URL!;
  if (!/\/1$/.test(url)) throw new Error(`Refusing to flush non-test Redis: ${url}`);
  const redis = new Redis(url);
  await redis.flushdb();
  await redis.quit();
}
