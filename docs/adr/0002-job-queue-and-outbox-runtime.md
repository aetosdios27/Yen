# ADR 0002: Job Queue and Outbox Runtime

Status: Accepted for YEN-62  
Date: 2026-10-27

## Context

Notifications, reconciliation, and blockchain anchoring execute as background work in Yen. Financial transparency requires that background jobs dispatched from domain state transitions (such as ledger journal postings and event log appends) execute reliably without dual-write inconsistencies or phantom operations if a transaction fails.

## Decision Summary

1. **Engine**: Start with `pg-boss` (v12 on PostgreSQL 16) as the baseline job engine.
2. **Transactional Outbox**: All domain-dispatched jobs are enqueued inside caller-owned transactions using `transactionalEnqueue()`, providing strict atomicity with database writes.
3. **Architecture**: Implement the worker runtime as a dedicated workspace package `@yen/queue` (`packages/queue`).
4. **Schema Coexistence**: `pg-boss` operates in the isolated `pgboss` schema, coexisting without collision with `@yen/db`'s migration runner. Production workers execute with `migrate: false` to ensure zero untracked runtime DDL.
5. **Exit Criteria**: Escape hatches to BullMQ (high-throughput short jobs) and Temporal (long-lived multi-step sagas) are governed by machine-readable thresholds evaluated via `evaluateExitCriteria()`.
6. **Worker Concurrency & Queue Policy Semantics**:
   - Worker concurrency is configured per-node via `localConcurrency` (matching pg-boss v12 `WorkConcurrencyOptions.localConcurrency`), spawning distinct worker polling loops per queue.
   - Queue execution policies (`retryLimit`, `retryDelay`, `retryBackoff`, `expireInSeconds`, `deadLetter`) are established during queue creation via `boss.createQueue(queueName, queueOptions)` so jobs automatically inherit queue policies without duplicate overrides at enqueue time.

## Comparative Analysis of Queue Engines

| Dimension                 | pg-boss (Chosen Baseline)                   | BullMQ (Escape for Short Idempotent Jobs)            | Temporal (Escape for Sagas & Anchoring)                  |
| :------------------------ | :------------------------------------------ | :--------------------------------------------------- | :------------------------------------------------------- |
| **Primary Source**        | [pg-boss](https://pgboss.io)                | [BullMQ](https://docs.bullmq.io)                     | [Temporal](https://docs.temporal.io)                     |
| **Storage Dependency**    | PostgreSQL 12+ (uses PostgreSQL 16)         | Redis >= 6.2 or Valkey                               | Temporal Cluster + DB (Postgres/Cassandra) + ES          |
| **Transactional Enqueue** | Native via caller transaction (`tx.unsafe`) | Impossible without separate 2PC or Outbox CDC        | Impossible without separate Outbox CDC                   |
| **Dual-Write Risk**       | None (atomic with Postgres writes)          | High (dual writes between Postgres & Redis)          | High (dual writes between Postgres & Temporal)           |
| **Operational Cost**      | $0 incremental infrastructure               | Additional Redis/Valkey cluster & backup maintenance | High: 4 microservices or Temporal Cloud ($25/mo + usage) |
| **Retry & Dead-Letter**   | Configurable retries, backoff, and DLQ      | Supported in Redis                                   | Built-in workflow retry policies and activity retries    |
| **Best Suited For**       | Atomic outbox enqueue, short/batch jobs     | High-frequency ephemeral jobs (>10k depth)           | Multi-day workflows, sagas with compensation logic       |

## Measurable Exit Criteria

| Work Shape           | Queue                  | Metric              | Threshold                      | Target Engine | Failure Mode / Rationale                                                                    |
| :------------------- | :--------------------- | :------------------ | :----------------------------- | :------------ | :------------------------------------------------------------------------------------------ |
| Short idempotent     | `notifications`        | Backlog Depth       | > 10,000 jobs sustained > 15m  | BullMQ        | Table bloat / autovacuum degradation ([Brandur Leach](https://brandur.org/postgres-queues)) |
| Short idempotent     | `notifications`        | P99 Latency         | > 5,000 ms                     | BullMQ        | Delivery lag unacceptable for interactive verification/OTP                                  |
| Scheduled batches    | `reconciliation`       | Backlog Depth       | > 500 batches sustained > 30m  | Temporal      | Accumulating batches indicates queue processing bottleneck                                  |
| Scheduled batches    | `reconciliation`       | P99 Latency         | > 60,000 ms                    | Temporal      | Reconciliation delays delay accounting audit verification                                   |
| Long-lived anchoring | `blockchain-anchoring` | Workflow Duration   | > 86,400 s (24 hours)          | Temporal      | Multi-day reorg confirmation exceeds polling lease model                                    |
| Long-lived anchoring | `blockchain-anchoring` | Orchestration Steps | > 10 distinct steps            | Temporal      | Complex saga requires event-sourced execution history                                       |
| Global database      | All queues             | DB CPU Saturation   | > 25% CPU attributed to queue  | Target Engine | Prevents queue polling from starving core ledger transactions                               |
| Global database      | All queues             | DB IOPS Saturation  | > 30% IOPS attributed to queue | Target Engine | Prevents vacuum / WAL overhead from starving database disk I/O                              |

## Migration Runner Coexistence

- The repository migration runner (`packages/db/src/migrate.ts`) enforces strict SQL AST validation and consecutive version numbering for schema `public`.
- `pg-boss` maintains 13 internal tables, enums (`job_state`), and PL/pgSQL functions entirely in the isolated `pgboss` schema.
- In production, workers run with `migrate: false`.
- Schema provisioning is managed explicitly via `ensureQueueSchema()` during deployment.
- If outbox tables are ever moved into `public`, the next migration number in this branch is 0002, which renumbers to 0004 upon rebase onto `main` following waitlist (0002) and fund_events (0003).
