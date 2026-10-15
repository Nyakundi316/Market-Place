Object.assign(process.env, {
  NODE_ENV: 'test',
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL:
    process.env.DATABASE_URL_TEST ??
    'postgresql://markethub:markethub@localhost:5432/markethub_test?schema=public',
  REDIS_URL: process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghij',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdefghij',
  // SeaweedFS from infra/docker-compose.yml (CI starts the same image).
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
  S3_BUCKET: process.env.S3_BUCKET ?? 'markethub',
  S3_PRIVATE_BUCKET: process.env.S3_PRIVATE_BUCKET ?? 'markethub-private',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'markethub',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'markethub-dev-secret',
  S3_REGION: 'us-east-1',
});
