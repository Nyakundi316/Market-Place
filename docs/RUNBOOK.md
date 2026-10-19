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
| Payments | Paystack (KES/NGN/GHS/ZAR/USD; card, bank, M-Pesa / mobile money) | Webhooks are the only thing that marks orders paid. |
| Errors / traces | Sentry, any OTLP collector | Both optional; off when their env is blank. |

## 2. Configuration

Every variable is validated at boot (`packages/shared/src/env.ts`); the API refuses to start with a bad or missing production value and logs which key. `.env.example` lists them all.

Set API secrets with `fly secrets set -a markethub-api KEY=value …` (each set restarts machines). Required in production:

- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — ≥ 32 chars, different from each other
- `INTERNAL_API_KEY` — same value on **web and API**; lets server-rendered pages skip the per-IP limit
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PRIVATE_BUCKET` (+ `S3_PUBLIC_URL`)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `MAIL_FROM`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT`, defaults to `mailto:` + `MAIL_FROM`'s address) — Web Push; without them push is off. **Generate once and keep**: a new pair silently invalidates every browser's subscription
- `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY` (+ `AFRICASTALKING_SENDER_ID`) — without them phone verification shows as unavailable
- Optional: `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, OAuth client ids/secrets

Web secrets: `INTERNAL_API_KEY`, `SENTRY_DSN`. Build-time (public) values come from the deploy workflow: `API_URL`, `WEB_URL`, `NEXT_PUBLIC_SENTRY_DSN`.

## 3. First-time setup

1. `fly apps create markethub-api` and `markethub-web`; provision Postgres and Redis; set secrets (§2).
2. R2: two buckets. Public one behind a custom domain; private one with public access **off**. CORS on both for `WEB_URL` (PUT, GET; header `content-type`).
3. Resend: verify the sending domain; set `MAIL_FROM`.
4. Paystack: enable transfers; webhook URL `https://<api>/webhooks/paystack`; set `PAYSTACK_WEBHOOK_SECRET`.
5. Africa's Talking: create the live app, top up SMS credit, and apply for an alphanumeric sender id (e.g. `MARKETHUB`; approval takes days per country). Set the `AFRICASTALKING_*` secrets. A low balance shows up as 503s on `/me/phone/send-code` and `InsufficientBalance` warnings in the API log.
6. Web Push: `npx web-push generate-vapid-keys` once; set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` on the API and store the pair in your password manager. Never rotate casually: every existing browser subscription stops working and users have to switch push back on.
7. First deploy (§4). Then create the admin once, with the credentials set for that command only (use a throwaway password and change it after the first sign-in, since it lands in your shell history):
   ```bash
   fly ssh console -a markethub-api -C "sh -c 'cd /app && SEED_ADMIN_EMAIL=you@… SEED_ADMIN_PASSWORD=… node ./node_modules/tsx/dist/cli.mjs prisma/seed.ts'"
   ```
   (Not `.bin/tsx`: pnpm makes that a shell script, which `node` can't run.)
8. DNS: apex → web, `api.` → API. Confirm `/robots.txt` allows crawling only on the real https domain.

## 4. Deploying

**Normal path:** GitHub → Actions → **Deploy** → pick *staging* or *production* → *api-then-web*. It refuses unless CI is green on that commit, deploys the API (Fly runs `prisma migrate deploy` as the release command before any new machine takes traffic), then the web. URLs come from that GitHub environment's `API_URL` / `WEB_URL` variables; nothing environment-specific lives in the toml files.

Manual equivalent (production; for staging add `-staging` to both app names and say `DEPLOY_ENV=staging`):

```bash
fly deploy --config infra/fly/api.toml -a markethub-api --remote-only \
  -e WEB_URL=https://<domain> -e API_URL=https://api.<domain> -e DEPLOY_ENV=production
fly deploy --config infra/fly/web.toml -a markethub-web --remote-only \
  -e WEB_URL=https://<domain> -e API_INTERNAL_URL=http://markethub-api.internal:3001 \
  --build-arg API_URL=https://api.<domain> --build-arg WEB_URL=https://<domain> --build-arg DEPLOY_ENV=production
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
| Before a big launch/promo | Actions → **Load test (staging)** (§11); watch API p95, Postgres CPU, Redis ops |
| Quarterly | Backup restore drill; review admin accounts |

## 10. Known gaps before launch

No feature gaps left in code. What remains is accounts and keys (§2, §3), standing up staging (§11) and a ramp run there; the checklist lives in `PROGRESS.md` → "Before launch".

## 11. Staging

The production apps and configs with a `-staging` suffix: `markethub-api-staging` (2 machines, like production, so sockets cross machines through the Redis adapter) and `markethub-web-staging`. It is a production build (`NODE_ENV=production`, every §2 key required) marked `DEPLOY_ENV=staging`. That marker keeps robots.txt closed to crawlers, and it's the only place `seed:load` agrees to run.

**Set up once**

1. `fly apps create markethub-api-staging` and `fly apps create markethub-web-staging`.
2. Postgres and Redis **of its own**, never production's (same options as §1). Set `DATABASE_URL` and `REDIS_URL` on `markethub-api-staging`.
3. The other §2 secrets, with test values: Paystack **test** keys (`sk_test_…`) and a test-mode webhook to `https://markethub-api-staging.fly.dev/webhooks/paystack`; `AFRICASTALKING_USERNAME=sandbox` with the sandbox key; a separate VAPID pair, separate JWT secrets and `INTERNAL_API_KEY` (same value on both staging apps); two staging R2 buckets set up as in §3.2. Resend can share production's key: load-test users are on a reserved `.test` domain and are never mailed.
4. GitHub → Settings → Environments → **staging**: variables `API_URL=https://markethub-api-staging.fly.dev`, `WEB_URL=https://markethub-web-staging.fly.dev`; secret `JWT_ACCESS_SECRET` = the staging API's (k6 signs tokens with it). Give **production** its own `API_URL` / `WEB_URL`.
5. `FLY_API_TOKEN` (repo secret, or per environment) must be allowed to deploy and, for the load test, to `fly ssh`. If the load workflow's seed step is refused, give the staging environment an org token (`fly tokens create org`) as its own `FLY_API_TOKEN`.
6. Actions → **Deploy** → *staging*. Then create an admin as in §3.7 with `-a markethub-api-staging`.

**Load test:** Actions → **Load test (staging)**. Run *smoke* first: it seeds 10 users and proves tokens, search and sockets work end to end. Then *ramp*: browsing climbs to `browse_peak` users and chat to `chat_peak`, in fifths, two minutes per step, and each stops at the first step that breaks a threshold. The run's summary page shows each result; `vus` max is roughly the level it held. Latency budgets include the runner's measured round trip to `jnb`, since GitHub's runners are far away. Load users are removed at the end even when a run fails; after a hard cancel:

```bash
fly ssh console -a markethub-api-staging -C "sh -c 'cd /app && node ./node_modules/tsx/dist/cli.mjs prisma/seed-load.ts --clean'"
```

**Between load tests** staging can idle on one API machine (`fly scale count 1 -a markethub-api-staging`). Scale back to 2 before a ramp run, because cross-machine fan-out is part of what it tests.
