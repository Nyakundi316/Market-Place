# Progress

_Last updated: 2026-10-19_

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

## Shipped — Phase 3 (Chat) ✅
3.1 shared chat schemas/DTOs + typed socket events ✅ → 3.2 chat REST (find-or-create, list, messages cursor, send, read; authz 404 for non-members; verified + profile to chat; 20/10s fixed window shared with socket) ✅ → 3.3 Socket.IO gateway (JWT handshake, redis adapter, rooms, presence, typing, receipts; integration tests) ✅ → 3.4 BullMQ + notify:offline worker ✅ → 3.5 web chat UI (/chat, /chat/[id], /chat/new; realtime bridge, optimistic sends, receipts, typing, presence, photos, unread badges) ✅ → 3.6 gateway integration tests + chat E2E ✅

Decisions:
- Chat uploads use the existing presigned flow with a `chat` purpose (images + mp4)
- Presence key is a per-user socket counter with the §5 60s TTL, so closing one of two tabs doesn't show you offline
- `ConversationDto.counterpart.online` comes from Redis so the UI has presence before the first `presence:update`
- Socket CORS + Redis adapter are set in `ChatIoAdapter` (decorators run before env validation); pub/sub channel is namespaced by NODE_ENV since pub/sub ignores the Redis DB
- Gateway re-reads the user on every send/read: bans cut the socket off, and verifying email mid-session works without reconnecting
- Jobs run in the API process (`JobsService`); BullMQ forbids ':' in queue names, so §8 `notify:offline` = queue `notify`, job `offline`. Final failures go to a `dead-letter` queue
- notify:offline is debounced by jobId `offline:{recipient}:{conversation}` + 60s delay; at run time it re-checks presence/unread, emails (HTML-escaped), and writes a `chat.message` Notification that doubles as the retry idempotency marker
- Web connects Socket.IO straight to `NEXT_PUBLIC_API_URL` (inlined from `API_URL` at build; already in turbo's build env), since the /api rewrite can't upgrade WebSockets. Socket first with ack, REST fallback when disconnected
- E2E helpers shared in `e2e/fixtures.ts` (verifiedUser, postListing, png)
- New conversations get `lastMessageAt = now()` so they sort before their first message; the trigger takes over after

## Shipped — Phase 4 (Offers & Orders) ✅
- **4.1** shared offer/order/notification contracts; `ORDER_TRANSITIONS` + per-side `ORDER_ACTIONS`; cents-based money helpers (`orderTotals`, `formatAmount`)
- **4.2** offers API: create/counter/accept/decline/withdraw + `GET /offers/mine`; row lock on the conversation per transition; offer/offer_response chat messages; `offer:new|update` events
- **4.3** `offer:expire` delayed job (48h), idempotent
- **4.4** orders API: from an accepted offer (idempotent per offer), `ORD-YYYY-NNNNNN` from a sequence, stock reserved under a listing lock, ship/deliver/confirm-delivery/cancel, `order:payment-timeout` (24h), all audited
- **4.5** notifications: `notify()` = row + `notification:new` + `email:send` when offline; list/read/read-all
- **4.6** web: OfferCard in the thread, OfferDialog (= CounterOfferModal), Make offer from composer and listing CTA, CheckoutDialog
- **4.7** web: `/deals` (buying/selling orders + open offers), `/orders/[id]` (OrderTimeline, role-aware money, action dialogs)
- **4.8** web: NotificationBell (sidebar + mobile header), toasts for deal events
- **4.9** API e2e: notifications 6, offers 14, orders 14; Playwright `deals.spec.ts` (two browsers: offer → counter → accept → checkout → order → seller cancels, buyer page updates live)
- Fix found on the way: BullMQ rejects custom jobIds containing `:` unless they have exactly three parts — `email:{id}` silently never queued. Job ids now use `-`; rule noted in `jobs.module.ts`

Decisions:
- Offers expire after 48h; one pending offer per conversation — a new one from the same side withdraws the old, from the other side it's a counter
- Job listings don't take offers; non-negotiable listings only accept the listed price
- Stock is reserved when the order is created and released on cancel; listing goes `sold` at 0 and back to `active` when a cancel restocks it; DB CHECK keeps stock ≥ 0
- On a `request` ("Wanted") listing the poster is the buyer
- Either side can cancel while `awaiting_payment`; unpaid orders auto-cancel after 24h
- Platform fee comes out of the seller's side: buyer pays `total = subtotal`, seller nets `subtotal − fee` (§7 "transfer net")
- `completedDeals` is incremented for both parties on completion
- Email for deal notifications only when the recipient has no live socket (same rule as chat)
- Push (FCM) deferred to Phase 7 with device tokens — no `push:send` queue yet, since it would have nothing to send
- `ship/deliver/confirm-delivery` are reachable only from `in_escrow`, i.e. after Phase 5 payments; until then the buyer's order page explains that checkout is being switched on

Tests: shared 61 · api unit 17 · api e2e 182 · web unit 23 · Playwright 30 (deals 2 + chat 4 + listings 8 + auth 16) — all green, 0 lint warnings

## Shipped — Phase 5 (Payments & Escrow) ✅
- **5.1** `WebhookEvent`, `PayoutAccount` (+ amount CHECK); pay/dispute/refund actions; payment, dispute, payout contracts; `STRIPE_PUBLISHABLE_KEY`
- **5.2** `PaymentProvider` (§7) with Stripe (PaymentIntents, Connect transfers + Express onboarding, `constructEvent`), Paystack (hosted checkout, transfers, recipients, HMAC-SHA512) and a sandbox for keyless dev/test
- **5.3** `POST /orders/:id/pay` (order lock, idempotency key per attempt) and `/webhooks/*` (verify → dedupe → apply in one tx; amount mismatch audited; late payments refunded)
- **5.4** escrow release on confirm, auto-release after delivery, fee rows, payout accounts, nudge + release when the seller's account becomes ready
- **5.5** disputes within the window; admin release/refund/split; seller refund of paid orders (restocks)
- **5.6** nightly reconciliation (recover missed webhooks, close abandoned charges, alert on mismatch)
- **5.7** web: PaymentDialog (Elements / Paystack / sandbox), confirming-payment polling, dispute + refund dialogs, escrow notes, Settings → Payouts
- **5.8** API e2e: payments 16 (pay, declines, replay, bad signatures, mismatch, late pay, release, auto-release, split dispute, window, refund, payouts, reconciliation); provider unit tests 6; Playwright deals spec now runs the full money path

Decisions:
- Gateway per currency: Paystack NGN/GHS/KES/ZAR, Stripe the rest; keyless gateways fall back to the sandbox (never in production — env requires keys)
- Gateway calls run inside the DB transaction that records them (25s tx timeout): a failure leaves nothing half-done and the request/job can retry
- No payout account → order completes, escrow stays `held`, seller notified; adding an account releases everything waiting
- Split disputes charge the platform fee on what the seller keeps
- A transfer that fails or is reversed puts the hold back to `held` and is audited for an admin
- Payout retries and repeat refunds get numbered idempotency keys (`:payout:2`, `:refund:2`); rows are never deleted

Tests: shared 62 · api unit 23 · api e2e 198 · web unit 23 · Playwright 30 — all green, 0 lint warnings. One full Playwright run had 2 failures in the photo-upload wait under load; they passed on the rerun.

## Shipped — Phase 6 (Trust) ✅
- **6.1** `VerificationRequest`; private bucket for documents (anonymous read scoped to the public bucket; compose init retries); trust contracts
- **6.2** reviews: buyer rates seller on completed orders, one per order, rating trigger, `GET /reviews/mine`
- **6.3** verification: phone codes (hash in Redis, tries/send caps, dev outbox), ID/business documents, admin approve/reject with signed previews
- **6.4** reports (listing/user/message/review, one open per reporter) and moderation: remove listing, hide review, warn, ban (sessions revoked, sockets dropped), unban — all audited in-transaction
- **6.5** admin overview, user search (warnings, open reports), audit viewer
- **6.6** seller analytics + nightly response rates
- **6.7** web: review form, report dialog, Settings → Verification, `/seller` stats, `/admin` (overview, reports, disputes, verifications, users, audit)
- **6.8** API e2e: reviews 3, verification 6, admin 9, analytics 2; Playwright `trust.spec.ts` (report → admin removes; ID → admin approves → badge)

Decisions:
- Only the buyer reviews (one review per order per §3); hidden reviews leave the average
- Report resolution closes every open report on the same thing and thanks each reporter (no details shared)
- Admins can't be warned/banned from the panel, and nobody moderates themselves
- Phone verification needs an SMS provider before launch (not in the §1 stack) — **open question**
- Response rate = buyer chats in the last 90 days answered within 24h

Local verification note: the last local browser run of `trust.spec.ts` was blocked by Docker port forwarding to Redis/Postgres failing under memory pressure (`wslrelay` resets); the API suites for 6.2–6.6 passed locally, and CI runs the browser specs on clean services.

## Shipped — Phase 7 (Launch prep) ✅
- **7.1** SEO: `/sitemap.xml` (from `GET /seo/sitemap`), `/robots.txt` (crawlable only on production https), JSON-LD (WebSite+search, Product/Service+Offer, breadcrumbs, ProfilePage; `<` escaped), metadataBase, noindex on private pages and sold listings
- **7.2** PWA: manifest, icons drawn by next/og (no binaries), offline page, service worker that never caches /api or signed-in data
- **7.3** i18n scaffold: typed `en` catalogue, `t()` with params, shell migrated (text unchanged)
- **7.4** Observability: OpenTelemetry traces (OTLP) and Sentry errors, both off until configured; Sentry 11's default data collection (bodies, headers, cookies, user) switched off
- **7.5** k6: `load/listings.js`, `load/chat.js` (Socket.IO by hand), `seed:load` fixtures; smoke-tested locally (chat p95 delivery 123 ms, 0 errors)
- **7.6** Deploy: Dockerfiles (API + web standalone), Fly configs, CI builds both images, manual deploy workflow gated on green CI
- **7.7** `docs/RUNBOOK.md`

Fixes found on the way:
- **SSR rate limiting**: every server-rendered page fetch came from the web server's one IP, so all public SSR traffic shared 100 req/min → `INTERNAL_API_KEY` exemption (GET, global bucket only)
- Socket.IO websocket-only (polling across machines would need sticky sessions)
- next/og icons on the edge runtime (Node runtime font loading fails on Windows); Next standalone output only inside Docker (symlinks need Developer Mode on Windows)
- Docker: Prisma schema must be present before `pnpm install` (postinstall generate)

Tests: shared 68 · api unit 25 · api e2e 220 · web unit 29 · Playwright 34 (33 first try, 1 passed on retry — the known-flaky live chat test) · images build in CI

## Shipped — post Phase 7
- **§8 `listing:expire`**: hourly BullMQ scheduler (`:07` UTC) flips `active` listings past `expiresAt` to `expired`, unfeatures them, recomputes `Profile.listingsCount`, and sends one `listing.expired` notification per seller linking to `/seller?tab=expired` (renew = publish again). Idempotent via the status guard; search already hid them at the deadline.
- **§8 `audit:cleanup`**: nightly (03:15 UTC) housekeeping in `modules/audit/cleanup.ts`: refresh tokens 30d past expiry, auth tokens expired/used >30d, read notifications >90d, processed webhook events >90d. **Decision (2026-10-15): `audit_logs`, transactions and escrow rows are never pruned**; unprocessed webhook events are kept for inspection
- **Paystack only** (2026-10-15): Stripe removed — it doesn't serve Kenyan businesses. README, RUNBOOK and the brief addendum caught up on 2026-10-19
- **Landing + auth redesign**: the wordmark owns the first screen ("What's MarketHub?" pill pours out the brief); auth is one dark layout with a Sign up / Log in card. Left alone, the landing hands off to /signup after the intro — once per tab (Back doesn't bounce) and never for crawlers
- **Phone verification live** via **Africa's Talking** (decision 2026-10-19): `AFRICASTALKING_USERNAME`/`_API_KEY` (+ `_SENDER_ID`); "sandbox" username → their simulator. Refused sends drop the code; unreachable numbers come back as a field error
- **Push notifications** via **Web Push (VAPID)**, not FCM (decision 2026-10-19: FCM's legacy server key API is shut down, the app is a PWA, no Firebase SDK/account needed). `PushSubscription` model + migration, `GET /push/config`, `POST|DELETE /me/push-subscriptions`, §8 `push:send` beside `email:send` and `notify:offline`, Settings → Notifications, service-worker `push`/`notificationclick`. Verified end to end in real Chrome against Google's push service
- Service worker: precache is now best-effort (a failed `/offline` or icon fetch used to stop the whole worker installing — and push with it)
- E2E fixes: `deals.spec` still used pre-M-Pesa payout copy (red since 2213a09); the landing tap test raced hydration under load

Tests (2026-10-19, local, prod builds): shared 73 · api unit 32 · api e2e 231 · web unit 32 · Playwright 42 (39 first run; the 3 failures above fixed and rerun green)

## Shipped — Phase 8 (Launch readiness)
Scope agreed 2026-10-19: merge the launch polish, screen sizes, staging + load test. **Meilisearch moved to "later"** (the brief's own word): Postgres search already handles typos in titles and is fine at launch scale; revisit for search-as-you-type, synonyms (simu → phone) or ~100k listings. **Swahili dropped** (owner's call).
- **8.0** PR #1 (launch polish) merged, fast-forward. Its first CI run caught a real bug: the sending tab got its own `message:new` before the ack, so every sender briefly saw their message twice (the "known-flaky" chat test). The gateway now excludes the sending socket; the sender's other tabs still get it. Also a sign-up test race and two push spec type errors that only `tsc` saw
- **8.1** Screen sizes (§0, §11): the mobile project runs at 375px (was 412); `e2e/responsive.spec.ts` visits every main screen (public, auth, onboarding, buyer/seller with a live chat thread, admin) at 375/768/1280 and fails on sideways scroll, anything past the right edge outside a scroll container, or a missing main nav. Every screen already fit; the detector was checked against an injected overflow
- **8.2** Staging + load: **Deploy** takes staging|production (same Fly configs, `-staging` app suffix, 2 API machines; URLs from each GitHub environment, nothing per-environment in the toml files). **Load test (staging)** seeds users over `fly ssh`, measures the runner's round trip to jnb, ramps listings and/or chat, posts results to the run summary and always cleans up. k6 ramp mode: climb in fifths of `PEAK`, abort at the first broken threshold, `vus` max ≈ what it held. RUNBOOK §11

Fixes found on the way:
- `robots.txt` would have let staging be indexed (production build on https). `DEPLOY_ENV` build arg, declared in turbo.json (strict env mode would hide it from `next build`)
- `tsx` was a dev dependency, so the deployed image couldn't run RUNBOOK §3.7's admin seed. Now a runtime dependency, and CI runs `seed-load.ts` inside the built image to prove both that and its production guard
- Mail to reserved domains (`.test`, `.example`, `.invalid`, `.localhost`, `.local`) never reaches Resend. Load users would otherwise have bounced thousands of offline-notify emails off the sending domain
- k6 listings favourited the VU's own listing; the correct 400 counted in `http_req_failed` and would stop ramp runs
- `seed:load` runs on staging only (needs `DEPLOY_ENV=staging` under `NODE_ENV=production`) and takes `--out`

Tests (2026-10-19): shared 73 · api unit 35 · api e2e 232 · web unit 35 · Playwright 46 (mobile 21 at 375px + desktop 21 + responsive 4). k6 ramp checked locally through `grafana/k6` at PEAK=12

## Before launch (everything)
Accounts and keys only — no open feature decisions. Details in `docs/RUNBOOK.md` §2–3 (production) and §11 (staging).
- [ ] `INTERNAL_API_KEY`, `JWT_*` (generate), `WEB_URL`/`API_URL`
- [ ] R2: public + private buckets, CORS for `WEB_URL`
- [ ] Resend: verify the sending domain, set `MAIL_FROM`
- [ ] Paystack live: `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET` (same value: Paystack signs webhooks with the secret key); webhook → `{API_URL}/webhooks/paystack`; enable transfers
- [ ] Africa's Talking: live app + SMS credit, apply for a `MARKETHUB` sender id (takes days), `AFRICASTALKING_*`
- [ ] Web Push: `npx web-push generate-vapid-keys` once → `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; keep the pair safe (rotating it kills every subscription)
- [ ] OAuth (optional): Google + GitHub client ids/secrets
- [x] Fly account (bazantyloffan@gmail.com, org `personal`) and `FLY_API_TOKEN` repo secret (2026-10-19)
- [x] Staging apps created: `markethub-api-staging`, `markethub-web-staging`
- [x] GitHub environment `staging` with `API_URL` / `WEB_URL` (the fly.dev URLs). `production` environment not created yet
- [x] Payment method on Fly (the "unauthorized" on `fly secrets list` was billing; it works since the card was added)
- [x] Staging Postgres 16: `markethub-db-staging` in `jnb` (self-run Fly Postgres, 1 node, 1 GB, 10 GB disk), attached to the API (`DATABASE_URL` set). Choice 2026-10-19: self-run, all in jnb, ~$10/month with Redis
- [x] Staging Redis `markethub-redis-staging` running in `jnb` (redis 7.4, AOF on a 1 GB volume, noeviction, no public IPs); config `infra/fly/redis-staging.toml`
- [x] `bash infra/fly/set-staging-secrets.sh` run 2026-10-19 08:18: JWT pair, `INTERNAL_API_KEY` (both apps), VAPID, `REDIS_URL` / `REDIS_PASSWORD`, and the k6 `JWT_ACCESS_SECRET` on GitHub (placeholder replaced). API/web secrets stay staged until their first deploy
- [x] Paystack test key on staging (both names, same value). The first test key was printed by a PowerShell error during setup and was regenerated in Paystack
- [ ] R2: buckets `markethub-staging` (public) + `markethub-staging-private`, a read/write token → `S3_*`; Resend → `RESEND_API_KEY` (+ `S3_PUBLIC_URL`, `MAIL_FROM`). The API won't boot without them → Deploy → staging
- [ ] **Decision for production**: Fly Managed Postgres isn't offered in `jnb` (nearest: ams/fra/lhr). Options: self-run Fly Postgres in jnb (we own backups and failover; RUNBOOK §8 assumes point-in-time recovery), a managed Postgres in South Africa from another provider, or moving the stack to Europe
- [ ] Load test (staging): smoke, then ramp; note what `vus` max held and which threshold broke first

Local dev: `.env` now has a dev-only VAPID pair (push works with `pnpm build && pnpm start`; the service worker isn't registered under `pnpm dev`). For SMS locally, put the Africa's Talking sandbox username `sandbox` + its key in `.env`, or leave blank to read codes from the Redis outbox / API log.

## Blockers / decisions
- `@RateLimit('auth')` (10/min/IP) covers credential endpoints only; refresh/logout/provider list are on the global limit (CGNAT would otherwise sign users out)
- Locally the 8 GB machine swaps during E2E (argon2 + Chromium + Docker); `/health` hit 5s. Run E2E against `pnpm build` + `start`, not `pnpm dev`
- Escrow model (Phase 5): charge now, platform holds the funds, Paystack transfer to the seller on release
- `main` is pushed to `origin`; CI runs on every push. Phase 8 is on `feat/phase-8` (PR to `main`)
- Not verifiable without a Fly account: the Deploy/Load workflows' `flyctl` steps. Whether `fly deploy -e` overrides toml `[env]` is undocumented, so no value is set in both places; whether a deploy token may `fly ssh` is noted in RUNBOOK §11.5
- Headless Chrome via Playwright: a `viewport` override on a persistent context breaks Cache Storage ("Entry already exists"); not an app bug, noted for anyone scripting push checks
- Stitch MCP not connected; UI follows §6 + CLAUDE.md design rules directly
