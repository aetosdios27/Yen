# YEN-58 Benchmark Suite: Event Log at Scale

This directory contains rerunnable benchmark scripts evaluating PostgreSQL layout, append contention, hot-fund isolation, and streaming chain verification for [YEN-58](https://linear.app/yen-pbl/issue/YEN-58) and [ADR 0001](../0001-event-log-at-scale.md).

## Benchmark Scripts

### 1. `bench-verify-1m.mjs`

Evaluates verification throughput and memory of `verifyChainStream` from `@yen/eventlog` on synthetic event chains. Event construction and hashing are timed separately and excluded from the verification figures; verification timing still includes async stream handoff overhead. The first run warms up the JIT.

```sh
node docs/adr/YEN-58/bench-verify-1m.mjs              # 1,000 to 1,000,000 events
node docs/adr/YEN-58/bench-verify-1m.mjs 1000,10000,100000
```

**Results:** The figures below were measured by the earlier version of this script, which timed generation and verification together. They are superseded and must be re-measured with the current script before they are cited.

- 1,000 events: 0.165s (6,052 ev/s), Peak Heap 11.60 MB
- 10,000 events: 1.713s (5,838 ev/s), Peak Heap 14.98 MB
- 100,000 events: 16.190s (6,176 ev/s), Peak Heap 22.18 MB
- 1,000,000 events: 188.884s (5,294 ev/s), Peak Heap 34.97 MB (streaming, but timed with generation)

### 2. `bench-postgres.mjs`

Compares PostgreSQL unpartitioned vs 16-partition vs 32-partition hash layouts under varying concurrency ($c \in \{1, 4, 8, 16\}$). Tests hot fund contention, multi-fund scaling, hot-fund isolation (measuring Fund B during Fund A saturation), and query plans.

Each layout is built in turn as the table `fund_events`, because the migration 0003 insert trigger reads the chain head from a table with that name.

#### Prerequisites

1. Node 24 and `pnpm install` from the repository root. Build the eventlog package, because the script imports its compiled output:

   ```sh
   pnpm --filter @yen/eventlog build
   ```

2. An existing PostgreSQL 16 admin connection. Create a dedicated database; the benchmark itself refuses to connect to the shared `postgres` database:

   ```sh
   export YEN_TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/postgres
   createdb --maintenance-db="$YEN_TEST_DATABASE_URL" yen_test_yen58
   export YEN_TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/yen_test_yen58
   ```

3. Apply migration `0001` from this branch to the isolated database:

   ```sh
   psql "$YEN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 < packages/db/migrations/0001_app_tables.sql
   ```

4. Migration `0003_fund_events.sql`. It is not on `main` or on this branch. The benchmark prerequisite is pinned to the immutable YEN-21 commit [`d99146a3bcd88d312409a5fcd081069ab5b4105d`](https://github.com/aetosdios27/Yen/blob/d99146a3bcd88d312409a5fcd081069ab5b4105d/packages/db/migrations/0003_fund_events.sql). The script needs its `yen_fund_lock_key(uuid)` function and its `yen_fund_events_before_insert()` trigger function. Apply that pinned file:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/aetosdios27/Yen/d99146a3bcd88d312409a5fcd081069ab5b4105d/packages/db/migrations/0003_fund_events.sql \
     | psql "$YEN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1
   ```

   This pinned prerequisite makes the setup reproducible from this checkout without requiring the other PR's commit to exist in the local Git object database. When the migration lands on this branch, use the committed migration instead.

The script checks for the tables and functions above before it changes anything and exits with the list of missing items if any are absent. For an existing Postgres installation, use its admin URL only for `createdb`; point `YEN_TEST_DATABASE_URL` at `yen_test_yen58` before applying migrations and running the benchmark.

#### Run

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/yen_test_yen58 node docs/adr/YEN-58/bench-postgres.mjs
```

The script drops and recreates `fund_events` in that database and upserts seed rows in `users`, `orgs`, `pseudonyms` and `funds`. It requires both a loopback host (`localhost`, `127.0.0.1` or `[::1]`) and a database name starting with `yen_test_`; it refuses the shared `postgres` database and has no override. The URL is validated with the same parser as `packages/db`. `YEN_TEST_DATABASE_URL` must be set explicitly.

The script exits non-zero if any append fails. A failed background append during the isolation test stops the run before any isolation result is printed.

**Results:** The Postgres figures recorded in ADR 0001 sections 3.1 to 3.3 came from an earlier version of this script. The earlier version failed at seeding against migration `0003` as pinned above, so those figures do not reproduce from the current script and must be re-measured. Use the current script on a quiet machine with more samples before relying on any latency target.

### 3. `bench-charts.html`

Self-contained HTML visual containing SVG charts and metric tables for append throughput, hot-fund isolation, and streaming verification scaling. The charts show the superseded figures above and must be regenerated from re-measured results.

## References

Citations follow [docs/REFERENCES.md](../../REFERENCES.md). See [ADR 0001](../0001-event-log-at-scale.md) for full architectural analysis and DDL recommendations.
