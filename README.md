# Market-Place

MarketHub — a marketplace where users post products and services by category, chat in real time, negotiate offers, and pay through escrow.

See [PROJECT_BRIEF.md](PROJECT_BRIEF.md) for the full spec and [PROGRESS.md](PROGRESS.md) for current status.

Stack: Next.js 14 · NestJS · Prisma/Postgres 16 · Redis 7 · Socket.IO · BullMQ · pnpm + Turborepo.

## Running locally

Needs Node 20 (`.nvmrc`), pnpm 9 and Docker.

```bash
pnpm install
cp .env.example .env          # fill JWT_* (openssl rand -base64 48) and SEED_ADMIN_PASSWORD
pnpm docker:up                # postgres :5432, redis :6379, mailhog :1025 / UI :8025
pnpm db:migrate && pnpm db:seed
pnpm dev                      # web :3000, api :3001
```

The browser only talks to `localhost:3000`; `/api/*` is proxied to Nest so auth cookies stay first-party. Dev mail lands in Mailhog at http://localhost:8025.

| Command | What it does |
| --- | --- |
| `pnpm test` | unit tests (shared, api, web) |
| `pnpm test:e2e --filter api` | API e2e against `markethub_test` (migrated automatically) |
| `pnpm --filter web test:e2e` | Playwright at 412px and 1280px; reuses running dev servers, but a production build (`pnpm --filter web build && pnpm --filter web start`) is much faster on slow machines |
| `pnpm lint` / `pnpm typecheck` | 0 warnings / 0 errors is the bar (§11) |

CI (`.github/workflows/ci.yml`) runs all of the above against throwaway Postgres, Redis and Mailhog services.

## Environment

Validated at boot by `packages/shared/src/env.ts`; the API refuses to start on a bad value. See `.env.example` for every key. In production the S3, Stripe (incl. `STRIPE_PUBLISHABLE_KEY`), Paystack and Resend keys are required and `WEB_URL`/`API_URL` must be https.

## API

All routes need `Authorization: Bearer <access token>` unless marked public. Lists are cursor-paginated (`?cursor=&limit=`, max 50). Errors are `{ statusCode, error, message, fields?, requestId }`.

### Auth (rate limit 10/min/IP)
| | |
| --- | --- |
| `POST /auth/register` · `/auth/login` | public; returns access token, sets `mh_rt` (httpOnly) and `mh_csrf` cookies |
| `POST /auth/refresh` · `/auth/logout` | cookie + `x-csrf-token` header; refresh tokens are single-use |
| `POST /auth/verify-email` · `/auth/forgot-password` · `/auth/reset-password` | public |
| `GET /auth/oauth` | public; enabled providers |
| `GET /auth/oauth/:provider` · `/auth/oauth/:provider/callback` | public; Google (PKCE), GitHub |

### Profile
| | |
| --- | --- |
| `GET /me` · `PATCH /me` | first PATCH creates the profile (needs `displayName` + `username`) |
| `POST /me/avatar` | body `{ url }` from a presigned `avatar` upload |
| `GET /users/:username` | public; banned users 404 |
| `POST /users/:id/follow` · `DELETE /users/:id/follow` | |
| `GET /users/:id/reviews` | public |

### Categories & listings
| | |
| --- | --- |
| `GET /categories` · `GET /categories/:slug` | public; tree / one node with parent + children |
| `POST /categories` · `PATCH /categories/:id` · `DELETE /categories/:id` | admin |
| `GET /listings` | public; `q, categoryId, minPrice, maxPrice, country, city, rating, verified, sort` (FTS + trigram) |
| `GET /listings/:slug` | public; drafts visible to the owner only |
| `GET /listings/mine` · `GET /listings/favorites` | |
| `POST /listings` · `PATCH /listings/:id` · `DELETE /listings/:id` | owner; create = draft |
| `POST /listings/:id/publish` · `/boost` | publish needs a confirmed email and ≥1 photo |
| `POST /listings/:id/favorite` · `DELETE /listings/:id/favorite` | |
| `POST /images/sign` | presigned PUT (`listing`, `avatar`, `chat`); jpeg/png/webp/mp4 ≤ 20 MB |

### Chat (REST fallback; Socket.IO is primary)
| | |
| --- | --- |
| `GET /conversations` · `/conversations/:id` · `/conversations/:id/messages` | members only, others get 404 |
| `POST /conversations` | find-or-create by `listingId`; 201 new / 200 existing |
| `POST /messages` · `POST /conversations/:id/read` | 20 msgs / 10 s, shared with the socket |

Socket.IO (`NEXT_PUBLIC_API_URL`, JWT in the handshake): `message:send|new|read`, `typing`, `presence:update`, `ping:presence`, `conversation:new|join`, `offer:new|update`, `notification:new`.

### Offers
| | |
| --- | --- |
| `POST /offers` | `{ conversationId, unitPrice, quantity?, message? }`; total and currency are set server-side. One pending offer per chat: a new one from the same side replaces it, from the other side it counts as a counter |
| `POST /offers/:id/counter` | recipient only; `{ unitPrice, quantity?, message? }` |
| `POST /offers/:id/accept` · `/decline` | recipient only; accept re-checks stock, fixed price and listing status |
| `POST /offers/:id/withdraw` | author only |
| `GET /offers/mine` | `role=sent\|received\|all`, `status`, `conversationId` |

Offers expire after 48 h (`offer` queue, job `expire`).

### Orders
| | |
| --- | --- |
| `POST /orders` | buyer only, from an accepted offer; `{ offerId, deliveryMethod, deliveryAddress? (courier), notes? }`. Idempotent per offer: 201 new / 200 existing. Reserves stock |
| `GET /orders` · `GET /orders/:id` | `role=buying\|selling\|all`, `status`; parties only |
| `POST /orders/:id/ship` | seller, from `in_escrow`; `{ trackingNumber? }` |
| `POST /orders/:id/deliver` | seller, from `shipped` |
| `POST /orders/:id/confirm-delivery` | buyer, from `shipped` or `delivered` |
| `POST /orders/:id/cancel` | either side while `awaiting_payment`; `{ reason? }`; restocks |

Order numbers are `ORD-YYYY-NNNNNN` from a Postgres sequence. The platform fee (`PLATFORM_FEE_PERCENT`) comes out of the seller's side; the buyer pays the agreed price. Unpaid orders are cancelled after 24 h (`order` queue, job `payment-timeout`). Every status change is written to `audit_logs`.

### Payments & escrow
| | |
| --- | --- |
| `POST /orders/:id/pay` | buyer; returns a payment session (Stripe client secret + publishable key, Paystack hosted URL, or sandbox). Idempotent per order; never marks it paid. Rate limit 5/min |
| `POST /orders/:id/dispute` | buyer, from `shipped`/`delivered`, within `DISPUTE_WINDOW_DAYS` of delivery; `{ reason }` |
| `POST /orders/:id/refund` | seller, from `in_escrow`: full refund, item back on sale |
| `GET /me/payout-accounts` · `POST /me/payout-accounts/stripe` · `POST /me/payout-accounts/paystack` | Stripe Connect Express onboarding (returns `actionUrl`) or a Paystack recipient `{ bankCode, accountNumber, currency }` |
| `GET /payments/banks?currency=` | NGN, GHS, KES, ZAR |
| `GET /admin/disputes` · `POST /admin/disputes/:orderId/resolve` | admin; `{ outcome: release\|refund\|split, refundAmount?, note }` |
| `POST /webhooks/stripe` · `/webhooks/paystack` | public, signature-checked over the raw body, not rate limited |

Flow (§7): pay → gateway → **webhook** marks the order paid and opens an `EscrowHold` → ship → deliver → buyer confirms (or `ESCROW_AUTO_RELEASE_HOURS` pass) → net of the fee is transferred to the seller's payout account. Without a payout account the money waits in escrow and the seller is asked to add one. Disputes freeze the hold until an admin releases, refunds or splits it. Money rows are never deleted; refunds and reversals are new rows.

Gateways: Paystack for NGN/GHS/KES/ZAR, Stripe for everything else. **Without keys (dev/test) both are served by a sandbox**: Stripe's test cards (`4242 4242 4242 4242` pays, `4000 0000 0000 0002` declines), signed events through the same webhook path, instant payouts. Production refuses to boot without real keys.

### Trust: reviews, reports, verification
| | |
| --- | --- |
| `POST /reviews` · `GET /reviews/mine?role=given\|received` | buyer rates the seller once per completed order; a trigger keeps the profile average |
| `POST /reports` | `{ entityType: listing\|user\|message\|review, entityId, reason, details? }`; one open report per person per thing |
| `GET /me/verification` · `POST /me/verification` | ID (`documentType`) or business (`businessName`, `registrationNumber`) with document keys from `POST /images/sign` (`purpose: verification`, private bucket) |
| `POST /me/phone/send-code` · `POST /me/phone/verify` | 6-digit code, 10 min, 5 tries, 3 sends / 15 min. Dev/test: Redis outbox `sms:outbox:{phone}`; production: unavailable until an SMS provider is chosen |
| `GET /me/analytics?days=7\|30\|90` | seller analytics (views, offers, orders, payouts, reply rate, rating) |

### Admin (role = admin, every action audited)
| | |
| --- | --- |
| `GET /admin/overview` | queue counts and last-7-day numbers |
| `GET /admin/reports` · `POST /admin/reports/:id/resolve` | `{ action: resolve\|dismiss, note? }` closes every open report on that thing |
| `POST /admin/listings/:id/remove` · `POST /admin/reviews/:id/hide` | `{ reason }` |
| `GET /admin/users` · `POST /admin/users/:id/warn\|ban\|unban` | ban revokes sessions and drops sockets |
| `GET /admin/verifications` · `POST /admin/verify/:userId` | 5-minute signed document links; `{ requestId, decision, note? }` |
| `GET /admin/audit` | `entityType`, `entityId`, `actorId`, `action` (prefix) filters |

### Notifications
| | |
| --- | --- |
| `GET /notifications` | `unread=true\|false`; response also carries the `unread` count |
| `POST /notifications/read-all` · `POST /notifications/:id/read` | |

### Background jobs (BullMQ, in the API process)
| Queue · job | |
| --- | --- |
| `notify` · `offline` | chat email when the recipient has no socket, debounced 60 s |
| `email` · `send` | email for a notification when the recipient is offline |
| `offer` · `expire` | settles a pending offer at its `expiresAt` |
| `order` · `payment-timeout` | cancels an unpaid order after 24 h |
| `payout` · `release` | transfers the seller's net once the order completes |
| `payout` · `auto-release` | completes and releases `ESCROW_AUTO_RELEASE_HOURS` after delivery |
| `stats` · `response-rates` | 02:30 UTC: writes each seller's 24h reply rate to their profile |
| `reconcile` · `payments` | 03:00 UTC: compares recent charges with the gateway; recovers missed webhooks, alerts admins on mismatch |

All jobs are idempotent, retry 5× with exponential backoff, then go to `dead-letter`.
