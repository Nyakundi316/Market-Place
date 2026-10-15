# Progress

_Last updated: 2026-10-15_

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

## Before launch (everything)
- Real secrets for Stripe/Paystack (see below), `INTERNAL_API_KEY`, R2 buckets, Resend domain, `WEB_URL`/`API_URL`
- Fly account + `FLY_API_TOKEN` secret and `API_URL`/`WEB_URL` repo variables for the Deploy workflow
- **Open decisions:** SMS provider for phone verification; push notifications (FCM device tokens)
- Run k6 against staging at expected peak before opening the doors

## Before launch (payments)
- Put real keys in `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`
- Register webhook endpoints: Stripe → `{API_URL}/webhooks/stripe` (payment_intent.succeeded, payment_intent.payment_failed, refund.updated, transfer.reversed, account.updated); Paystack → `{API_URL}/webhooks/paystack`
- Enable Stripe Connect (Express) and Paystack transfers on the live accounts

## Blockers / decisions
- `@RateLimit('auth')` (10/min/IP) covers credential endpoints only; refresh/logout/provider list are on the global limit (CGNAT would otherwise sign users out)
- Locally the 8 GB machine swaps during E2E (argon2 + Chromium + Docker); `/health` hit 5s. Run E2E against `pnpm build` + `start`, not `pnpm dev`
- Escrow model (Phase 5): default is charge-now + platform-held funds + Connect transfer on release, since card auths expire in ~7 days
- Webhook idempotency (§7) will need a `WebhookEvent(eventId uniq)` table in Phase 5 — to be documented then
- `main` is pushed to `origin`; CI runs on every push
- Stitch MCP not connected; UI follows §6 + CLAUDE.md design rules directly
