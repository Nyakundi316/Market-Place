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

Validated at boot by `packages/shared/src/env.ts`; the API refuses to start on a bad value. See `.env.example` for every key. In production the S3, Stripe, Paystack, Resend and FCM keys are required and `WEB_URL`/`API_URL` must be https.

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

All jobs are idempotent, retry 5× with exponential backoff, then go to `dead-letter`.
