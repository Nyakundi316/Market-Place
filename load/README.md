# Load tests (k6)

Two scripts for §10 Phase 7: **listings** (browse/search/detail/favourite as
signed-in users) and **chat** (Socket.IO messaging between paired users).

Run them against **staging**, never production: they need the target's
`JWT_ACCESS_SECRET` to sign short-lived access tokens for seeded users, which
skips `/auth/login` (rate limited per IP, so one load machine would be the
bottleneck instead of the system under test).

## On staging: the Load test workflow

The usual way: GitHub → Actions → **Load test (staging)** (setup in
`docs/RUNBOOK.md` §11). It seeds users on `markethub-api-staging` over `fly ssh`,
measures the runner's round trip to `jnb`, runs the scripts, and removes the
users again. Start with **smoke** (10 users, proves the wiring), then **ramp**.

**Ramp** answers "how much can it take?" rather than "did it pass at N?". With
`PEAK` set, each script climbs in fifths of it (30 s up, 2 min held per step)
and its thresholds abort the run at the first step that breaks one
(`lib/ramp.js`). In the summary, `vus` max is roughly the level it held, and
the threshold marked ✗ is what gave out first. A run that holds the full peak
just means the next run can aim higher.

The steps below are the manual equivalent, e.g. from a machine in Kenya.

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

# ramp until something breaks; RTT_MS = your round trip to the API, added to latency budgets
k6 run … -e PEAK=300 -e RTT_MS=60 load/listings.js
k6 run … -e PEAK=1000 -e RTT_MS=60 load/chat.js     # needs --users ≥ PEAK when seeding
```

No local k6? `docker run --rm -v "$PWD/load:/load" -e … grafana/k6 run /load/chat.js`
works too (`host.docker.internal` reaches a local API).

## What "passing" means

| Script | Threshold |
| --- | --- |
| listings | errors < 1%; p95 feed < 400 ms, search < 600 ms, listing < 300 ms |
| chat | p95 send→ack < 250 ms, send→delivered < 500 ms, < 10 errors, p95 connect < 1 s |

Each latency budget gets `RTT_MS` added (three times for a new connection:
TCP, TLS, upgrade), so a far-away load machine isn't mistaken for a slow API.

Watch alongside: API p95 and Postgres CPU (traces if `OTEL_EXPORTER_OTLP_ENDPOINT`
is set), Redis ops/s, and `bull:*` queue depth (the offline-notify job fires for
every message whose recipient isn't connected).

Per-user limits still apply (100 req/min, 20 messages/10 s), so scale load with
**more users**, not faster users — that's what real traffic looks like too.
