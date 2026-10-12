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
| `GET /users/:username` | public; banned users 404 |
