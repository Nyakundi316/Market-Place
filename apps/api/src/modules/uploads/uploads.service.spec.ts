import type { Env } from '@markethub/shared';
import { UploadsService } from './uploads.service';

const env = {
  NODE_ENV: 'production', // skips the dev-only bucket CORS call
  WEB_URL: 'https://markethub-web-staging.fly.dev',
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'markethub-staging',
  S3_PRIVATE_BUCKET: 'markethub-staging-private',
  S3_PUBLIC_URL: 'https://pub-test.r2.dev',
  S3_ACCESS_KEY: 'AKID',
  S3_SECRET_KEY: 'secret',
} as Env;

describe('UploadsService.sign', () => {
  const uploads = new UploadsService(env);

  it('signs a PUT with type and size, and no checksum R2 would hold the photo to', async () => {
    const signed = await uploads.sign('user-1', {
      purpose: 'listing',
      contentType: 'image/webp',
      size: 12_345,
    });
    const url = new URL(signed.uploadUrl);

    expect(url.pathname).toMatch(/^\/markethub-staging\/listing\/user-1\/[0-9a-f-]{36}\.webp$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    // A CRC32 signed in here is computed over an empty body; R2 rejects every real upload.
    const checksumParams = [...url.searchParams.keys()].filter((k) => /checksum/i.test(k));
    expect(checksumParams).toEqual([]);
    expect(signed.publicUrl).toBe(
      `https://pub-test.r2.dev/${url.pathname.split('/').slice(2).join('/')}`,
    );
  });

  it('sends verification documents to the private bucket with no public URL', async () => {
    const signed = await uploads.sign('user-1', {
      purpose: 'verification',
      contentType: 'image/jpeg',
      size: 2_000,
    });
    expect(new URL(signed.uploadUrl).pathname).toMatch(
      /^\/markethub-staging-private\/verification\//,
    );
    expect(signed.publicUrl).toBeNull();
  });
});
