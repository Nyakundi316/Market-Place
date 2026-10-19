import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';

const crawlable = () => robots().rules;

describe('robots.txt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lets crawlers into production, minus private paths', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_URL', 'https://markethub.co.ke');
    vi.stubEnv('DEPLOY_ENV', 'production');
    expect(crawlable()).toEqual([
      expect.objectContaining({ allow: '/', disallow: expect.arrayContaining(['/api/']) }),
    ]);
  });

  it('keeps staging out even though it is a production build on https', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_URL', 'https://markethub-web-staging.fly.dev');
    vi.stubEnv('DEPLOY_ENV', 'staging');
    expect(crawlable()).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('keeps local production builds out', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_URL', 'http://localhost:3000');
    expect(crawlable()).toEqual([{ userAgent: '*', disallow: '/' }]);
  });
});
