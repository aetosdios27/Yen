# YEN-58 Benchmark Suite: Event Log at Scale

This directory contains rerunnable benchmark scripts evaluating PostgreSQL layout, append contention, hot-fund isolation, and streaming chain verification for [YEN-58](https://linear.app/yen-pbl/issue/YEN-58) and [ADR 0001](../0001-event-log-at-scale.md).

## Benchmark Scripts

### 1. `bench-verify-1m.mjs`

Evaluates the memory footprint and verification throughput of `verifyChainStream` from `@yen/eventlog` on synthetic event chains from 1,000 to 1,000,000 events.

```sh
node docs/adr/YEN-58/bench-verify-1m.mjs
```

**Results Summary:**
- 1,000 events: 0.165s (6,052 ev/s), Peak Heap 11.60 MB
- 10,000 events: 1.713s (5,838 ev/s), Peak Heap 14.98 MB
- 100,000 events: 16.190s (6,176 ev/s), Peak Heap 22.18 MB
- 1,000,000 events: 188.884s (5,294 ev/s), Peak Heap 34.97 MB ($O(1)$ memory streaming)

### 2. `bench-postgres.mjs`

Compares PostgreSQL unpartitioned vs 16-partition vs 32-partition hash layouts under varying concurrency ($c \in \{1, 4, 8, 16\}$). Tests hot fund contention, multi-fund scaling, hot-fund isolation (measuring Fund B during Fund A saturation), and query plans.

**Prerequisites:**
Start the dedicated test container:
```sh
podman run -d --name yen-pg-58 -p 55444:5432 -e POSTGRES_PASSWORD=pw postgres:16
podman exec -i yen-pg-58 psql -U postgres < packages/db/migrations/0001_app_tables.sql
podman exec -i yen-pg-58 psql -U postgres < packages/db/migrations/0003_fund_events.sql
```

**Run Benchmark:**
```sh
node docs/adr/YEN-58/bench-postgres.mjs
```

**Results Summary:**
- Single Hot Fund: throughput serialized at ~380–514 appends/sec by advisory lock.
- Spread Funds: throughput scales linearly with concurrency to 2,210 appends/sec at $c=16$.
- Isolation Guarantee: Fund B p99 latency strictly $< 5.0\text{ ms}$ (measured 4.20ms unpartitioned, 4.80ms hash-partitioned) during continuous Fund A saturation.
- Read Shapes: B-tree primary key `(fund_id, seq)` serves latest event (0.017ms), sequence range (0.036ms), and verification stream (0.433ms).

### 3. `bench-charts.html`

Self-contained HTML visual containing SVG charts and metric tables for append throughput, hot-fund isolation, and streaming verification scaling.

## References

Citations follow [docs/REFERENCES.md](../../REFERENCES.md). See [ADR 0001](../0001-event-log-at-scale.md) for full architectural analysis and DDL recommendations.
