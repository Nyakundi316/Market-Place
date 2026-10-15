# MarketHub runbook

For whoever is on call. Commands assume the repo root and a logged-in `flyctl`.

## 1. What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| `markethub-web` | Fly.io, `jnb`, ≥1 machine | Next.js standalone. Talks to the API over Fly's private network (`API_INTERNAL_URL`). |
| `markethub-api` | Fly.io, `jnb`, 2 always-on machines | NestJS + Socket.IO + BullMQ workers **in the same process**. Never scale to 0: payouts, offer and listing expiry, unpaid-order cancels and reconciliation run here. |
| Postgres 16 | managed (Fly Postgres / Neon / RDS) | Source of truth (§0). Point-in-time recovery on. |
| Redis 7 | managed (Upstash / Fly) | Cache, rate limits, presence, Socket.IO adapter, BullMQ. Losing it loses queued jobs, not money (see §6). |
| Object storage | Cloudflare R2 (S3 API) | `S3_BUCKET` public (custom domain → `S3_PUBLIC_URL`); `S3_PRIVATE_BUCKET` **no public access** (ID documents). |
| Email | Resend | Verified sending domain. |
| Payments | Stripe (USD/EUR/GBP/UGX/TZS) + Paystack (NGN/GHS/KES/ZAR) | Webhooks are the only thing that marks orders paid. |
| Errors / traces | Sentry, any OTLP collector | Both optional; off when their env is blank. |

## 2. Configuration

Every variable is validated at boot (`packages/shared/src/env.ts`); the API refuses to start with a bad or missing production value and logs which key. `.env.example` lists them all.

Set API secrets with `fly secrets set -a markethub-api KEY=value …` (each set restarts machines). Required in production:

- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — ≥ 32 chars, different from each other
- `INTERNAL_API_KEY` — same value on **web and API**; lets server-rendered pages skip the per-IP limit
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PRIVATE_BUCKET` (+ `S3_PUBLIC_URL`)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (+ `STRIPE_CONNECT_CLIENT_ID`)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `MAIL_FROM`
- Optional: `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, OAuth client ids/secrets

Web secrets: `INTERNAL_API_KEY`, `SENTRY_DSN`. Build-time (public) values come from the deploy workflow: `API_URL`, `WEB_URL`, `NEXT_PUBLIC_SENTRY_DSN`.

## 3. First-time setup

1. `fly apps create markethub-api` and `markethub-web`; provision Postgres and Redis; set secrets (§2).
2. R2: two buckets. Public one behind a custom domain; private one with public access **off**. CORS on both for `WEB_URL` (PUT, GET; header `content-type`).
3. Resend: verify the sending domain; set `MAIL_FROM`.
4. Stripe: enable Connect (Express). Add a webhook endpoint `https://<api>/webhooks/stripe` for `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.updated`, `transfer.reversed`, `account.updated`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. Paystack: enable transfers; webhook URL `https://<api>/webhooks/paystack`; set `PAYSTACK_WEBHOOK_SECRET`.
6. First deploy (§4). Then create the admin once: `fly ssh console -a markethub-api -C "node ./node_modules/.bin/tsx prisma/seed.ts"` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` set for that command only.
7. DNS: apex → web, `api.` → API. Confirm `/robots.txt` allows crawling only on the real https domain.

## 4. Deploying

**Normal path:** GitHub → Actions → **Deploy** → *api-then-web*. It refuses unless CI is green on that commit, deploys the API (Fly runs `prisma migrate deploy` as the release command before any new machine takes traffic), then the web.

Manual equivalent:

```bash
fly deploy --config infra/fly/api.toml --remote-only
fly deploy --config infra/fly/web.toml --remote-only \
  --build-arg API_URL=https://api.<domain> --build-arg WEB_URL=https://<domain>
```

**Migrations are forward-only.** Write them expand → deploy → contract: add the new column/table, ship code that writes both, backfill, and only drop the old thing in a later release. A migration that fails aborts the deploy; old machines keep serving.

## 5. Rolling back

```bash
fly releases -a markethub-api            # find the last good version and its image
fly deploy -a markethub-api --config infra/fly/api.toml --image <registry.fly.io/...:deployment-...>
```

Do the same for web if needed (web first if only the UI is broken). Database changes are **not** rolled back — that's why migrations must stay backward compatible (§4).

## 6. Day-to-day

- **Health:** `GET /health` reports Redis and Postgres; Fly checks it every 15 s.
- **Logs:** `fly logs -a markethub-api`. Every request has an `x-request-id`; it's in the response, in the logs, and on Sentry events. Users can quote it from error screens.
- **Scale:** `fly scale count 3 -a markethub-api`. Sockets work across machines through the Redis adapter, which is why the client is websocket-only (polling would need sticky sessions).
- **Queues** (BullMQ, Redis): `notify`, `email`, `offer`, `order`, `payout`, `reconcile`, `stats`, `listing` (hourly expiry), `cleanup` (nightly housekeeping). Jobs retry 5× with backoff, then land in `dead-letter` with the error. Every job is idempotent, so re-adding one is safe:
  ```bash
  fly ssh console -a markethub-api -C "node -e \"…\""   # or redis-cli against REDIS_URL:
  LRANGE bull:dead-letter:wait 0 20
  ```
- **Nightly jobs:** reconciliation 03:00 UTC, response rates 02:30 UTC. An admin gets a notification (and Sentry an error) if reconciliation finds a mismatch.

## 7. When things break

### Payments
- **Orders stuck in "awaiting payment" after customers paid** → webhooks aren't arriving or are rejected. Check `fly logs` for `rejected webhook` (signature) and the gateway dashboard's delivery log. Signature failures after a secret rotation: update `*_WEBHOOK_SECRET`. The nightly reconciliation also recovers missed successes; to run it now: open a console and call `ReconciliationService.run()`, or add a `reconcile`/`payments` job.
- **Reconciliation mismatch alert** → the gateway disagrees with us about an amount or status. Don't edit rows. Compare in the gateway dashboard, then resolve through the product (refund/dispute flows) so the audit trail and transactions stay consistent. Rows are never deleted.
- **Payout failed / reversed** → the escrow hold goes back to `held` and the audit log has `payout.failed`. Usually a closed bank account or Connect requirements: ask the seller to update payout details (Settings → Payouts); adding a ready account re-queues release automatically.
- **Duplicate charge worry** → can't happen through the app: one charge row per attempt key, under an order lock, and webhooks are deduplicated by event id. If the gateway shows two successful charges for one order, the second was refunded automatically (`payment.late` in the audit log).

### Infrastructure
- **Redis down** → rate limits fail **open** except payments, which fail **closed** (`/orders/:id/pay` returns 503). Chat presence and live updates stop; sends fall back to REST. Queued jobs are lost if Redis data is lost: run reconciliation afterwards, and re-check unpaid orders (they'll cancel on the next scheduled run or stay open until handled).
- **Postgres down** → everything returns 503 from `/health`; nothing to do in the app but wait for failover. After recovery, run reconciliation.
- **Uploads failing** → check R2 status and CORS (`WEB_URL` must be allowed for PUT).
- **Emails not arriving** → `email` queue failures in logs/Sentry; Resend dashboard for bounces and domain status.

### Abuse
- Spam or scam wave: admin panel → Reports / Users → ban (revokes sessions, drops sockets at once) and remove listings. Every action is in the audit log.
- Credential stuffing: auth routes are limited to 10/min/IP; watch `429`s on `/auth/login` in logs.

### Compromised secret
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: rotate both with `fly secrets set` → every session ends; users log in again. Refresh tokens are stored hashed and single-use.
- Gateway keys: roll them in the gateway dashboard, update secrets, then check webhooks still verify.
- `INTERNAL_API_KEY`: set the new value on API **and** web in the same window.

## 8. Backups

- Postgres: point-in-time recovery + daily snapshots kept 30 days. **Restore drill every quarter** into a scratch database; check row counts on `orders`, `transactions`, `escrow_holds`.
- R2: object versioning on both buckets.
- Redis holds nothing that can't be rebuilt (see §7).

## 9. Routine

| When | What |
| --- | --- |
| Every 90 days | Rotate JWT secrets (§9 of the brief) — plan for users being signed out |
| Monthly | Dependency updates (`pnpm outdated`), review Sentry's top issues, check the dead-letter queue |
| Before a big launch/promo | k6 on staging (`load/README.md`); watch API p95, Postgres CPU, Redis ops |
| Quarterly | Backup restore drill; review admin accounts |

## 10. Known gaps before launch

- **Phone verification** needs an SMS provider (none is in the stack yet); until then it reports "coming soon" in production.
- **Push notifications** (FCM) and device tokens are not built yet; users get in-app and email notifications.
