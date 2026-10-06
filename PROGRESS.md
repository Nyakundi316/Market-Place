# Progress

_Last updated: 2026-10-06_

## Shipped — Phase 1 (Foundation)
- **1.0** `packages/config`: shared tsconfig (base/nest/next/lib), ESLint flat config, Prettier; LF via `.gitattributes`; pnpm pinned to 9.15
- **1.1** `infra/docker-compose.yml`: Postgres 16, Redis 7, Mailhog (healthchecks, configurable host ports); `.env.example` covers all §12 vars
- **1.2** `packages/shared`: zod env schema (prod-only required keys, OAuth all-or-nothing), auth/profile/pagination schemas, DTO types — 21 tests
- **1.3** `apps/api` NestJS scaffold: env validated before boot, pino logging with request ids, `ApiErrorDto` filter, response sanitiser, Helmet, CORS = WEB_URL, `/health` — 6 unit + 4 e2e tests
- **1.4** Prisma schema: all 20 §3 models + `RefreshToken`, `AuthToken` (see brief §3 addendum)
- **1.5** Migrations: init + raw SQL (partial/GIN indexes, CHECKs, 3 triggers) — 6 DB integration tests; no Prisma drift
- **1.6** Seed: 10 root / 45 sub categories + admin (idempotent, never overwrites passwords) — dev DB reset with user consent and seeded
- **1.7** Redis module + Lua token-bucket rate limiting as a global guard (§9 policies; payment fails closed)
- **1.8** Auth core: argon2id, HS256 access JWT, opaque refresh tokens (HMAC-stored, single-use, family revocation on reuse), register/login/refresh/logout, CSRF double-submit, audit on register

Tests: shared 21 · api unit 12 · api e2e 40 — all green

## In progress
- **1.9** JwtAuthGuard (global, @Public opt-out), Roles/Verified guards, @CurrentUser; verify-email, forgot/reset-password (Mailhog in dev)

## Next
1.10 OAuth → 1.11 profile endpoints → 1.12 web scaffold → 1.13 auth pages → 1.14 onboarding → 1.15 E2E + CI

## Blockers / decisions
- Escrow model (Phase 5): default is charge-now + platform-held funds + Connect transfer on release, since card auths expire in ~7 days
- Webhook idempotency (§7) will need a `WebhookEvent(eventId uniq)` table in Phase 5 — to be documented then
- ts-jest `isolatedModules` deprecation warning — tidy in 1.15
