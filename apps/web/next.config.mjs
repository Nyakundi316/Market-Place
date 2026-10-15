import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Server-side only: where the Next server reaches Nest. Browsers only ever see /api/*.
const API_ORIGIN = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:3001';
const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Socket.IO can't go through the /api rewrite (no WebSocket upgrade), so the
  // browser needs the API's public origin. Inlined at build time from API_URL.
  env: { NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:3001' },
  poweredByHeader: false,
  // Self-contained server bundle, for the Docker image only (infra/Dockerfile.web sets
  // NEXT_OUTPUT). Off elsewhere: tracing uses symlinks, which Windows refuses without
  // Developer Mode, and local `next start` doesn't need it.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Next 14: enables src/instrumentation.ts (server-side Sentry).
  experimental: {
    instrumentationHook: true,
    // Monorepo: trace dependencies from the repo root so workspace packages are included.
    outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  },
  // Same-origin proxy so auth cookies stay first-party (see PROJECT_BRIEF §3 addendum).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The worker must never be served stale, or a broken one could stick around.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
