# Load tests (k6)

Two scripts for §10 Phase 7: **listings** (browse/search/detail/favourite as
signed-in users) and **chat** (Socket.IO messaging between paired users).

Run them against **staging**, never production: they need the target's
`JWT_ACCESS_SECRET` to sign short-lived access tokens for seeded users, which
skips `/auth/login` (rate limited per IP, so one load machine would be the
bottleneck instead of the system under test).

## 1. Seed fixtures on the target

```bash
# against the staging DATABASE_URL
pnpm --filter api seed:load -- --users 200     # writes load/fixtures.json (ids only)
```

`--clean` removes every load-test user (they all use `@load.markethub.test`).

## 2. Run

```bash
k6 run -e API_URL=https://api.staging.example -e JWT_ACCESS_SECRET=… load/listings.js
k6 run -e API_URL=https://api.staging.example -e JWT_ACCESS_SECRET=… -e VUS=100 load/chat.js
```

## What "passing" means

| Script | Threshold |
| --- | --- |
| listings | errors < 1%; p95 feed < 400 ms, search < 600 ms, listing < 300 ms |
| chat | p95 send→ack < 250 ms, send→delivered < 500 ms, < 10 errors, p95 connect < 1 s |

Watch alongside: API p95 and Postgres CPU (traces if `OTEL_EXPORTER_OTLP_ENDPOINT`
is set), Redis ops/s, and `bull:*` queue depth (the offline-notify job fires for
every message whose recipient isn't connected).

Per-user limits still apply (100 req/min, 20 messages/10 s), so scale load with
**more users**, not faster users — that's what real traffic looks like too.
