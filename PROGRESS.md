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

## Shipped — Phase 2 (Listings) ✅
- **2.1–2.8** shared listing/category schemas, categories API, listings CRUD + publish, presigned uploads (SeaweedFS S3 in compose, `POST /me/avatar`), search (FTS + trigram, filters, cursor), favourites/follow/boost, feed/category/search pages, listing detail with owner actions
- **2.9** `/create` 5-step wizard (type+category → details → photos → location+price → review), drafts or publish; client-side resize before upload (`lib/images.ts`, `photo-uploader.tsx`)
- **2.10** `/u/[username]` profile (listings/reviews tabs, follow), `/seller` dashboard (status tabs, manage menu), `/saved`, `/settings` (photo, profile, role); account menu links
- **2.11** `e2e/listings.spec.ts`: post with photos → buyer search/save/open/follow; drafts private + publish needs a photo + delete; category/search; settings
- Fixes found by E2E: country names now deterministic across Node/Chrome ICU (hydration #425/#422 on `/c/*`); card heart was covered by the stretched title link (unclickable); profile counts/follow state came from the anonymous 60s server cache and never refetched
- Refresh reuse grace window (15s, only while the chain hasn't moved on): an aborted refresh no longer logs the user out; brief §3 addendum updated. Also de-flaked the OAuth forged-state test (tamper was a no-op when state ended in `x`)

Tests: web unit 20 · api unit 17 · api e2e 123 · Playwright 24 (listings 8 + auth 16) against prod builds

## In progress — Phase 3 (Chat)
3.1 shared chat schemas/DTOs + typed socket events ✅ → 3.2 chat REST (find-or-create, list, messages cursor, send, read; authz 404 for non-members; verified + profile to chat; 20/10s fixed window shared with socket) ✅ → 3.3 Socket.IO gateway (JWT handshake, redis adapter, rooms, presence, typing, receipts) → 3.4 BullMQ + notify:offline worker → 3.5 web chat UI (/chat, /chat/[id]) → 3.6 gateway integration tests + chat E2E

Decisions:
- Chat uploads use the existing presigned flow with a `chat` purpose (images + mp4)
- Presence key is a per-user socket counter with the §5 60s TTL, so closing one of two tabs doesn't show you offline
- `ConversationDto.counterpart.online` comes from Redis so the UI has presence before the first `presence:update`
- New conversations get `lastMessageAt = now()` so they sort before their first message; the trigger takes over after

## Blockers / decisions
- `@RateLimit('auth')` (10/min/IP) covers credential endpoints only; refresh/logout/provider list are on the global limit (CGNAT would otherwise sign users out)
- Locally the 8 GB machine swaps during E2E (argon2 + Chromium + Docker); `/health` hit 5s. Run E2E against `pnpm build` + `start`, not `pnpm dev`
- Escrow model (Phase 5): default is charge-now + platform-held funds + Connect transfer on release, since card auths expire in ~7 days
- Webhook idempotency (§7) will need a `WebhookEvent(eventId uniq)` table in Phase 5 — to be documented then
- `main` is pushed to `origin`; CI runs on every push
- Stitch MCP not connected; UI follows §6 + CLAUDE.md design rules directly
