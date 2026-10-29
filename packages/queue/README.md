# @yen/queue

Background job worker runtime, outbox transactional enqueue helper, and exit-criteria evaluator for Yen.

## Blockchain anchoring

`AnchoringWorker` reads each active fund's new `fund_events` range under a fund advisory lock,
builds the existing one-fund interval commitment, persists an `anchors` row and event salts, and
then submits the root. The contract receives only a `bytes32` root and its global publication
sequence; fund IDs, event hashes, and salts stay in Postgres. A unique `(fund_id, from_seq, to_seq)`
constraint and a durable chain sequence make retries reuse the same anchor. The scheduled discovery
queue sends at most one active job per fund using pg-boss singleton keys.

`RootSigner` exposes the transaction account to the chain adapter. `KmsRootSigner` uses AWS KMS
`ECC_SECG_P256K1` keys with `ECDSA_SHA_256`; it fetches only the public key and asks KMS to sign
transaction digests. The DER signature is parsed, normalized to low-s, and assigned the recovery
parity that recovers the configured KMS address. The private key never enters the worker. Configure
`ANCHOR_KMS_KEY_ID` and standard AWS SDK credentials/region. The worker fails closed when KMS is
selected but not configured. `LocalDevRootSigner` reads `ANCHOR_PRIVATE_KEY` only as a local fallback.
The worker starts anchoring when `ANCHOR_RPC_URL` and `ROOT_REGISTRY_ADDRESS` are set.
`ViemRootChain` defaults to Polygon Amoy (chain 80002) and requires an explicit registry address and
RPC URL.

Anvil integration tests deploy the actual `RootRegistry` artifact and publish a root to a local
Anvil node. CI installs Anvil alongside Forge and runs this test without a skip condition.

The scheduled reconciliation worker checks every five minutes for funds with unanchored events whose
last anchor was created at least one hour ago, compares submitted/confirmed local roots with
`rootAt(sequence)`, and alerts when publisher balance falls below 0.05 native token. It emits
`anchor.stale`, `anchor.root_mismatch`, and `anchor.wallet_low` through the injected
`AnchorAlertSink` (the CLI implementation writes structured alerts to stderr). The `anchor.published`
event schema is immutable and only accepts `{ anchor_id, global_root }`; it has no receipt fields.
Consequently tx hash, block, and sequence remain in the anchors table/chain receipt and cannot yet be
appended to each fund log without a separately approved canonical event schema change.

Operational fee policy caps initial max fee at 50 gwei and priority fee at 1 gwei. After ten minutes,
a pending transaction is replaced with the same nonce and both fees are increased by 12.5%, up to
100 gwei max fee and 2 gwei priority fee. Once a cap prevents another replacement, the worker fails
closed for operator action. Migration `0015_anchor_replacements` permits the durable tx hash to change
only during a submitted-to-submitted replacement; anchor identity and root remain immutable.

The current confirmation policy requires 12 blocks after the publication block. A reorg can remove
a transaction or its receipt after an apparent success; therefore `confirmed` is an observed
depth, not irreversible finality. A later reorg must be reconciled by an operator or a future
canonical-chain monitor before Yen describes that anchor as confirmed. The chain registry alone
does not prove event completeness or off-chain data availability.

## ADR: job queue and outbox runtime (start with pg-boss, define the exit criteria)

Status: accepted for YEN-62.

### Context

Notifications (SMS OTP, alerts), reconciliation (bank webhook matching, batch ledgers), and blockchain anchoring (publishing Merkle root hashes to Ethereum/Polygon RootRegistry) all execute as background work.
Yen requires strict "hardcore trustable" financial semantics: background tasks triggered by financial events (donations, payouts, expenses) must never suffer from dual-write inconsistencies or phantom execution if a database transaction aborts.

### Options considered

1. **pg-boss (chosen baseline)**:
   PostgreSQL-native background job queue using `FOR UPDATE SKIP LOCKED`.
   - _Current facts_: pg-boss v12 (12.38.0 on Node >= 22.12; running on Node 24). Requires PostgreSQL 12+ (PostgreSQL 16 in `@yen/db`).
   - _Transactional enqueue_: Supports caller-owned transactions via custom `IDatabase` adapter (`{ executeSql(text, values) }`). Passing a Postgres.js transaction client (`tx.unsafe`) allows enqueuing background jobs inside the exact same database transaction as ledger writes and event log appends. Commits or rolls back atomically.
   - _Retry and dead-letter semantics_: Per-queue configurable `retryLimit`, exponential backoff (`retryBackoff: true`), retry delay, job expiration timeout (`expireInSeconds`), and automatic dead-letter queue routing (`deadLetter`) preserving the failure error payload and `sourceRootId`.
   - _Schema isolation_: Encapsulated within the `pgboss` schema.
   - _Operational cost_: Zero incremental infrastructure; utilizes existing Postgres 16 cluster.

2. **BullMQ**:
   Node.js distributed message queue backed by Redis or Valkey.
   - _Current facts_: Requires Redis >= 6.2 or Valkey cluster.
   - _Operational cost_: Requires provisioning, monitoring, high-availability failover, and memory-limit tuning (`maxmemory-policy`, AOF/RDB persistence) for a second stateful storage engine.
   - _Dual-write deficiency_: Redis cannot participate in PostgreSQL transactions. Enqueuing to BullMQ alongside PostgreSQL ledger writes creates dual-write failure modes (partial failures, phantom jobs on transaction rollback). Eliminating this requires an outbox table in Postgres polled by a relay daemon or CDC (Change Data Capture), which introduces the very queue table pg-boss already provides natively.

3. **Temporal**:
   Durable execution engine for complex, stateful, long-lived distributed workflows.
   - _Current facts_: Temporal server cluster requires four distinct services (Frontend, History, Matching, Worker) plus dedicated persistence (PostgreSQL/MySQL/Cassandra) and Elasticsearch/OpenSearch for search visibility; or Temporal Cloud SaaS subscription ($25/mo base + execution/storage costs).
   - _Operational cost_: Significant operational overhead for a small team.
   - _Fit_: Overkill for short idempotent jobs (SMS notifications) and simple scheduled batches, but an essential architectural escape hatch for complex multi-day blockchain anchoring workflows with reorg handling and compensation sagas.

### Decision

1. **Start with pg-boss** in a dedicated package `@yen/queue`.
   - Enqueue all domain-triggered background work using the transactional outbox helper `transactionalEnqueue(boss, tx, queueName, data, options)`.
   - Jobs commit or roll back atomically with domain database mutations.
2. **Package vs apps/api structure**:
   - Implemented as a dedicated workspace package `@yen/queue` (`packages/queue`).
   - _Justification_: Decouples HTTP request-response serving (`apps/api`) from worker process lifecycle, concurrency limits, signal handling, and background task execution. `apps/api` can import outbox enqueue helpers without bundling worker daemon machinery, and production worker containers run independent worker processes (`pnpm --filter @yen/queue start`).
3. **Schema coexistence with migration runner**:
   - `@yen/db` owns the `public` schema for all application tables (`schema_migrations`, `users`, `funds`, etc.).
   - `pg-boss` tables, enums (`job_state`), and maintenance routines reside strictly in the isolated `pgboss` schema, preventing any table name collisions or schema pollution.
   - In production, worker instances run with `migrate: false` to ensure workers never execute untracked DDL at boot time.
   - Schema provisioning is managed explicitly via `ensureQueueSchema()` during deployment.
4. **Define measurable exit criteria**:
   - Thresholds are pinned in machine-readable JSON (`packages/queue/src/exit-criteria.json`).
   - A tested evaluator (`evaluateExitCriteria()`) determines when metrics breach operational bounds, recommending BullMQ for high-volume short-job queuing or Temporal for multi-step workflow orchestration.

### Exit criteria (measured conditions)

Moving a queue from pg-boss to an alternative engine is triggered when any of the following measured conditions are breached:

| Work shape               | Queue                  | Metric              | Threshold                                 | Target engine     | Rationale                                                            |
| :----------------------- | :--------------------- | :------------------ | :---------------------------------------- | :---------------- | :------------------------------------------------------------------- |
| **Short idempotent**     | `notifications`        | Backlog Depth       | > 10,000 jobs sustained for > 15m (900s)  | **BullMQ**        | High write/poll churn causes Postgres MVCC dead-tuple bloat.         |
| **Short idempotent**     | `notifications`        | P99 Latency         | > 5,000 ms (5s)                           | **BullMQ**        | Polling lag impairs fast interactive delivery (e.g. OTP SMS).        |
| **Scheduled batches**    | `reconciliation`       | Backlog Depth       | > 500 batches sustained for > 30m (1800s) | **Temporal**      | Batch accumulation indicates processing bottlenecks.                 |
| **Scheduled batches**    | `reconciliation`       | P99 Latency         | > 60,000 ms (60s)                         | **Temporal**      | Unacceptable lag for financial reconciliation runs.                  |
| **Long-lived anchoring** | `blockchain-anchoring` | Workflow Duration   | > 86,400 s (24 hours)                     | **Temporal**      | Multi-day wait for confirmation/reorgs exceeds job lease design.     |
| **Long-lived anchoring** | `blockchain-anchoring` | Orchestration Steps | > 10 distinct steps                       | **Temporal**      | Multi-step saga with compensations requires durable history.         |
| **Global database**      | All queues             | DB CPU Saturation   | > 25% CPU attributed to queue             | **Target engine** | Protects core ledger transaction throughput from queue overhead.     |
| **Global database**      | All queues             | DB IOPS Saturation  | > 30% IOPS attributed to queue            | **Target engine** | Prevents queue table vacuum/write activity from starving ledger I/O. |

### Prior art and references

- [pg-boss](../../docs/REFERENCES.md#pg-boss) provides PostgreSQL-backed queuing with SKIP LOCKED and caller-owned transaction execution.
- [BullMQ](../../docs/REFERENCES.md#bullmq) details Redis-based distributed job queuing and operational requirements.
- [Temporal](../../docs/REFERENCES.md#temporal) provides durable workflow execution for long-lived, stateful multi-step sagas.
- [Postgres Job Queues & Failure By MVCC](../../docs/REFERENCES.md#brandur-queues) explains how transaction duration and high update churn cause table bloat and degrade Postgres-based queues.
- [Transactionally Staged Job Drains in Postgres](../../docs/REFERENCES.md#brandur-job-drain) motivates transactional outbox staging to ensure jobs are invisible until commit.
- [Timeouts, retries, and backoff with jitter](../../docs/REFERENCES.md#aws-retries) explains exponential backoff and jitter for resilient retries.
- [Making retries safe with idempotent APIs](../../docs/REFERENCES.md#aws-idempotency) explains atomic coordination of request tokens with database mutations.

## Usage

### Transactional Outbox Enqueue

```ts
import { createSql } from "@yen/db";
import { createPgBoss, transactionalEnqueue, buildIdempotencyKey } from "@yen/queue";

const sql = createSql(process.env.DATABASE_URL!);
const boss = createPgBoss({ connectionString: process.env.DATABASE_URL! });
await boss.start();

await sql.begin(async (tx) => {
  // 1. Domain write
  await tx`INSERT INTO ledger_entries ...`;

  // 2. Outbox enqueue inside the same transaction
  const key = buildIdempotencyKey("fund", fundId, eventId);
  await transactionalEnqueue(
    boss,
    tx,
    "notifications",
    { fundId, eventId },
    {
      singletonKey: key,
      singletonSeconds: 300,
    },
  );
});
```

### Worker Runtime

```ts
import { WorkerRuntime, DEFAULT_QUEUES } from "@yen/queue";

const worker = new WorkerRuntime({
  connectionString: process.env.DATABASE_URL!,
  schema: "pgboss",
  migrate: process.env.NODE_ENV !== "production",
  queues: DEFAULT_QUEUES,
});

worker.registerHandler("notifications", async (job) => {
  // Process job idempotently
  await sendSmsNotification(job.data);
});

await worker.start();
```

#### Queue Policy Configuration

Each queue is configured using `QueuePolicy` matching pg-boss v12 semantics:

- `localConcurrency`: Number of concurrent worker loops spawned per node for this queue (maps directly to pg-boss `WorkConcurrencyOptions.localConcurrency`). Defaults to 5.
- `batchSize`: Number of jobs fetched per batch (default: 1).
- `retryLimit`: Number of times a failed job is retried before routing to dead-letter queue or marking failed (default: 3).
- `retryDelay`: Delay between retries in seconds (default: 10).
- `retryBackoff`: Boolean indicating whether exponential backoff is applied across retries (default: true).
- `expireInSeconds`: Maximum active execution time in seconds before a job is considered expired (default: 60).
- `deadLetter`: Name of the dead-letter queue where payloads are sent when retries are exhausted.

### Evaluating Exit Criteria

```ts
import { evaluateExitCriteria, DEFAULT_EXIT_CRITERIA } from "@yen/queue";

const evaluation = evaluateExitCriteria({
  queueName: "notifications",
  queueDepth: 15000,
  queueDepthSustainedSeconds: 1200,
  p99LatencyMs: 6500,
});

if (evaluation.exceeded) {
  console.warn("Queue thresholds exceeded:", evaluation.reasons);
  console.log("Recommended target engine:", evaluation.recommendedEngine);
}
```
