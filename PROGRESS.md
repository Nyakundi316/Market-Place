# Progress

_Last updated: 2026-10-13_

## Shipped — Phase 1 (Foundation) ✅
- **1.0** `packages/config`: shared tsconfig (base/nest/next/lib), ESLint flat config, Prettier; LF via `.gitattributes`; pnpm pinned to 9.15
- **1.1** `infra/docker-compose.yml`: Postgres 16, Redis 7, Mailhog (healthchecks, configurable host ports); `.env.example` covers all §12 vars
- **1.2** `packages/shared`: zod env schema (prod-only required keys, OAuth all-or-nothing), auth/profile/pagination schemas, DTO types
- **1.3** `apps/api` NestJS scaffold: env validated before boot, pino logging with request ids, `ApiErrorDto` filter, response sanitiser, Helmet, CORS = WEB_URL, `/health`
- **1.4** Prisma schema: all 20 §3 models + `RefreshToken`, `AuthToken` (see brief §3 addendum)
- **1.5** Migrations: init + raw SQL (partial/GIN indexes, CHECKs, 3 triggers)
- **1.6** Seed: 10 root / 45 sub categories + admin (idempotent)
- **1.7** Redis module + Lua token-bucket rate limiting as a global guard (§9 policies; payment fails closed)
- **1.8** Auth core: argon2id, HS256 access JWT, opaque single-use refresh tokens with family revocation, CSRF double-submit
- **1.9** Global JwtAuthGuard, @Roles/@Verified, @CurrentUser; verify-email + forgot/reset-password
- **1.10** Google (PKCE) + GitHub OAuth
- **1.11** GET/PATCH /me, GET /users/:username; reserved usernames
- **1.12** apps/web: Next 14 + Tailwind + shadcn + React Query + Zustand + sonner, /api proxy, app shell
- **1.13** Landing + auth pages (login, signup, verify-email, forgot/reset, /auth/callback)
- **1.14** 3-step onboarding (identity → location → about), each step saves; ISO country validation in shared
- **1.15** Playwright E2E (16 tests, 412px + 1280px, console-error guard); GitHub Actions CI (checks + API/browser E2E with services); ts-jest deprecation fixed; turbo Strict env mode configured

Tests: shared 25 · api unit 17 · api e2e 73 · web unit 2 files · Playwright 16 — all green, 0 lint warnings

## In progress — Phase 2 (Listings)
2.1 shared listing/category schemas → 2.2 categories API → 2.3 listings CRUD + publish → 2.4 presigned uploads (+ MinIO in compose, `POST /me/avatar`) → 2.5 search (FTS + trigram, filters, cursor) → 2.6 favourites, follow, boost → 2.7 web feed/category/search → 2.8 listing detail → 2.9 create wizard → 2.10 profile + seller pages → 2.11 E2E

## Blockers / decisions
- Escrow model (Phase 5): default is charge-now + platform-held funds + Connect transfer on release, since card auths expire in ~7 days
- Webhook idempotency (§7) will need a `WebhookEvent(eventId uniq)` table in Phase 5 — to be documented then
- Commits are local only; nothing has been pushed to `origin` (CI runs once pushed)
- Stitch MCP not connected; UI follows §6 + CLAUDE.md design rules directly
