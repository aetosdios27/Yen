# @yen/load-tests

Reproducible load-test harness and performance budget validation for Yen.

## Overview

This package defines end-to-end performance test scenarios, latency budgets enforced as code, and state side-effect verification for high-throughput read, write, and authentication flows across Yen.

Load generation is driven by [Autocannon](https://github.com/mcollina/autocannon), providing low-overhead HTTP benchmarking with custom client generation for unique idempotency keys, UPI references (UTRs), and session validation tokens.

Following the principles of [Brendan Gregg's USE Method](../../docs/REFERENCES.md#gregg-use), [Service Level Objectives](../../docs/REFERENCES.md#sre-slo), and [Implementing SLOs](../../docs/REFERENCES.md#sre-implementing-slos), the harness quantifies utilization, saturation, and latency percentiles under load, asserting that the system operates within strict budgets.

---

## Performance Budgets as Code

Performance budgets are defined in `src/budgets.ts` and evaluated automatically at the conclusion of each scenario run:

| Scenario         | Endpoints                                  | Target Concurrency | p95 Budget   | p99 Budget   | Max Error Rate |
| :--------------- | :----------------------------------------- | :----------------- | :----------- | :----------- | :------------- |
| **Read-heavy**   | `/health`, `/v1/funds/{id}`, `/funds/{id}` | 10 connections     | **< 50 ms**  | **< 150 ms** | **0.00%**      |
| **Write-heavy**  | `/v1/funds/{id}/donations/pledge`          | 10 connections     | **< 120 ms** | **< 300 ms** | **0.00%**      |
| **Auth/Session** | `/v1/me`                                   | 10 connections     | **< 50 ms**  | **< 150 ms** | **0.00%**      |

If any percentile or error rate breaches the defined budget threshold, the runner prints an explicit metric breakdown and exits with a non-zero exit code (`1`).

---

## Scenarios

### Scenario 1: Read-Heavy

Exercises high-throughput read routes in round-robin fashion:
- `GET /health` (Process liveness)
- `GET /v1/funds/{fundId}` (Fund financial summary and target)
- `GET /funds/{fundId}` (Server-rendered public fund transparency view)

### Scenario 2: Write-Heavy (Donation Pledges)

Exercises the donation pledge creation path:
- `POST /v1/funds/{fundId}/donations/pledge`
- **Dynamic Per-Request Generation:**
  - Distinct UUID `Idempotency-Key` header on every request.
  - Distinct 12-digit UPI UTR (`^[0-9]{12}$`) on every request.
  - Integer `amountPaise` (`50000` paise = ₹500.00).

### Scenario 3: Auth / Session Validation

Exercises authenticated session verification under load:
- `GET /v1/me` with `Authorization: Bearer <session-token>`.
- Asserts auth cache efficiency and sub-50ms p95 response time.

---

## State Side-Effects Verification

Unlike naive load tests that only verify HTTP 200/201 response status codes, `@yen/load-tests` verifies state side-effects directly against the storage layer (`src/state-verifier.ts`):

1. **Baseline Count:** Queries `SELECT count(*) FROM donation_pledges` prior to the load run.
2. **Execution:** Dispatches concurrent requests with unique UTRs and idempotency keys.
3. **Post-Run Verification:** Asserts that newly created database rows strictly match the number of successful HTTP 201 responses (`createdRows === expectedRows`).
4. **Idempotency Replay Safety:** Replays an existing request with the identical `Idempotency-Key` and UTR, verifying that:
   - The response returns `201 Created` with `idempotent-replayed: true` (or identical cached body).
   - Zero additional rows are created in the database.

---

## Recorded Baselines

Recorded on Apple M-series (12-core ARM64, 36 GB RAM, Node.js v22.14.0):

```text
================================================================
Scenario: Read-heavy
================================================================
Throughput:  20,266 requests (20,264.0 req/s)
Latency:     p50: 0.0ms | p90: 0.0ms | p95: 0.0ms | p99: 0.0ms | max: 8.0ms
Errors:      0 socket errors, 0 non-2xx responses (Rate: 0.00%)
Budgets:     p95 <= 50ms [PASS] | p99 <= 150ms [PASS] | errors 0.00% [PASS]

================================================================
Scenario: Write-heavy (Donation Pledges)
================================================================
Throughput:  13,709 requests (13,708.0 req/s)
Latency:     p50: 0.0ms | p90: 0.0ms | p95: 0.0ms | p99: 0.0ms | max: 31.0ms
Errors:      0 socket errors, 0 non-2xx responses (Rate: 0.00%)
Budgets:     p95 <= 120ms [PASS] | p99 <= 300ms [PASS] | errors 0.00% [PASS]
State:       Database row count match: created 13,709 rows [PASS]
             Idempotency replay safety: 0 duplicate rows [PASS]

================================================================
Scenario: Auth / Session Validation
================================================================
Throughput:  22,967 requests (22,968.0 req/s)
Latency:     p50: 0.0ms | p90: 0.0ms | p95: 0.0ms | p99: 0.0ms | max: 14.0ms
Errors:      0 socket errors, 0 non-2xx responses (Rate: 0.00%)
Budgets:     p95 <= 50ms [PASS] | p99 <= 150ms [PASS] | errors 0.00% [PASS]
```

---

## CLI Usage

### Local Runner

Run all scenarios with default settings (5 seconds duration, 10 connections):

```bash
pnpm test:load
```

### Configurable Flags

```bash
# Custom duration and concurrency
pnpm test:load --duration 10 --connections 25

# Run only write scenario with state verification
pnpm test:load --scenario write --duration 5

# Target an existing local or staging server
pnpm test:load --target http://localhost:3000

# Specify database URL for PostgreSQL state side-effect verification
pnpm test:load --database-url postgres://postgres:pw@localhost:5432/postgres
```
