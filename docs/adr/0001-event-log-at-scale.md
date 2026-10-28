# ADR 0001: Event Log Storage Layout, Append Contention, and Retention at Scale

- **Status:** Proposed. Needs a maintainer decision on partitioning (Decision 1, item 5) before the migration changes. Reviewed and corrected after the first draft: the dynamic-SQL decision, the isolation guarantee and the archival strategy were wrong or overstated.
- **Date:** 2026-10-27
- **Issue:** [YEN-58](https://linear.app/yen-pbl/issue/YEN-58)
- **Deciders:** Design Sub-Agent, Core Database Engineering
- **Consulted:** [YEN-21](https://linear.app/yen-pbl/issue/YEN-21) (`@yen/eventlog`), [YEN-18](https://linear.app/yen-pbl/issue/YEN-18) (`@yen/db` migrations), [YEN-62](https://linear.app/yen-pbl/issue/YEN-62) (Transactional Outbox)

---

## 1. Context and Problem Statement

Yen is a transparency platform for community money in India. The fundamental trust model requires every financial operation on a fund (donations, expenses, policy changes, membership updates, bank transactions) to be captured in an append-only, tamper-evident hash chain ([Schneier and Kelsey](../../docs/REFERENCES.md#schneier-kelsey); [Crosby and Wallach](../../docs/REFERENCES.md#crosby-wallach)).

Each event envelope comprises:
- `fund_id` (UUIDv7 / UUID)
- `seq` (gapless 64-bit integer, starting at 1 per fund)
- `type` (strict event type string)
- `version` (schema version, 1)
- `actor` (`psn_<uuid>` pseudonym ID)
- `occurred_at` (canonical UTC ISO-8601 string `YYYY-MM-DDTHH:mm:ss.sssZ`)
- `payload` (`jsonb` containing PII-free IDs, hashes, and integer paise)
- `prev_hash` (64-char lowercase hex SHA-256; genesis is 64 zeroes)
- `hash` (`SHA-256("yen/eventlog/event/v1\0" || RFC8785(unsigned_envelope))`)
- `canonical_envelope` (RFC 8785 canonical JSON text representation of the 8 unsigned fields)

To guarantee that events cannot fork, skip sequences, or link to conflicting predecessors, the append path uses transaction-scoped PostgreSQL advisory locks keyed by fund ID (`pg_advisory_xact_lock(yen_fund_lock_key(fund_id))`) ([PostgreSQL Explicit Locking](../../docs/REFERENCES.md#pg-locking)).

An in-flight migration (`packages/db/migrations/0003_fund_events.sql`) is currently being implemented as a single unpartitioned table with `PRIMARY KEY (fund_id, seq)` and row-level insert triggers. Before the first production row exists, we must decide:
1. **Partitioning layout:** Should `fund_events` be hash-partitioned by `fund_id` or remain a single unpartitioned table? If partitioned, what modulus should be used, how can partitions be added without rewriting data, and what PostgreSQL constraints apply?
2. **Append contention and isolation:** What is the per-fund advisory lock hold time, what happens under high-concurrency contention on a hot fund, and are unrelated funds strictly isolated from that contention?
3. **Index plan:** How do the three operational read shapes (latest event, sequence range, full chain stream) perform on the layout?
4. **Anchoring batch read plan:** How can periodic anchoring jobs query events since the last anchor without scanning the entire table?
5. **Retention and cold storage:** How do we maintain an append-only record where nothing is deleted while keeping database operational costs and verification overhead bounded?
6. **Streaming verification cost at 1M events:** What is the runtime latency, throughput, and memory profile of `verifyChainStream` on a million-event chain?

---

## 2. Experimental Setup and Hardware Disclosures

Following the benchmark reporting discipline ([The USE Method](../../docs/REFERENCES.md#gregg-use)):

- **Machine:** Intel(R) Core(TM) Ultra 9 185H (16 physical cores: 6 Performance, 8 Efficient, 2 Low-Power Efficient; 22 execution threads; max turbo 5.10 GHz).
- **Memory:** 32 GB LPDDR5x (30 GiB usable, Linux 6.17 kernel).
- **Storage:** NVMe PCIe 4.0 SSD running over LUKS full-disk encryption with `ext4` filesystem.
- **Runtimes:**
  - Node.js v24.18.0 (V8 13.x, single-thread V8 heap limit 4,288 MB).
  - PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) running in Podman container (`yen-pg-58`), port 55444.
  - PostgreSQL settings: default Debian container configuration (`synchronous_commit = on`, `shared_buffers = 128MB`, `wal_buffers = 4MB`, `max_connections = 100`).
- **Reproducibility:** All benchmark scripts are committed in this repository under [`docs/adr/YEN-58/`](./YEN-58/):
  - [`bench-verify-1m.mjs`](./YEN-58/bench-verify-1m.mjs): Streaming verification of 1,000 to 1,000,000 synthetic chained events.
  - [`bench-postgres.mjs`](./YEN-58/bench-postgres.mjs): PostgreSQL contention, partitioning comparison (Unpartitioned vs 16-way vs 32-way Hash), isolation test, and query plan analyzer. It needs migrations 0001 and 0003 and a loopback test database; see [YEN-58/README.md](./YEN-58/README.md) (Prerequisites).

---

## 3. Empirical Measurements and Findings

> [!IMPORTANT]
> **Superseded measurements.** The figures in sections 3.1 to 3.4 came from earlier versions of the two benchmark scripts. The earlier Postgres script failed at seeding against migration 0003 as pinned in [YEN-58/README.md](./YEN-58/README.md), so its figures cannot be reproduced by the current script. The earlier verification script timed event generation together with verification. Re-measure both before relying on any figure here, and revisit the decisions that cite them (Decision 1, item 5; Decision 3; Consequences). Section 3.4 includes one post-fix run that reports the two phases separately.

### 3.1. Append Path: Hot Fund Contention vs. Spread Funds Scaling

Every append transaction executes through `appendEvent` (@yen/db, YEN-21):
1. `SELECT pg_advisory_xact_lock(yen_fund_lock_key($fund_id))`
2. `SELECT seq, hash, occurred_at FROM fund_events WHERE fund_id = $fund_id ORDER BY seq DESC LIMIT 1`
3. Node application builds next chained event via `makeNextEvent`
4. Node application canonicalizes unsigned envelope via `canonicalize` (RFC 8785)
5. `INSERT INTO fund_events (...) VALUES (...)` (trigger validates schema, previous hash, timestamp monotonicity, and SHA-256 hash)
6. `COMMIT` (releases advisory lock and syncs WAL)

We tested concurrency levels $C \in \{1, 4, 8, 16\}$ for:
- **Hot Fund Workload:** All $C$ concurrent workers repeatedly append to the same single fund.
- **Spread Funds Workload:** Workers distribute appends randomly across 50 distinct funds.

| Workload         | Concurrency | Table Layout   | Throughput (appends/sec) | p50 Latency (ms) | p90 Latency (ms) | p99 Latency (ms) | Max Latency (ms) |
| :--------------- | :---------: | :------------- | :----------------------: | :--------------: | :--------------: | :--------------: | :--------------: |
| **Hot Fund**     |    $c=1$    | Unpartitioned  |        **513.7**         |       1.74       |       2.51       |       4.41       |       4.77       |
| **Hot Fund**     |    $c=1$    | Hash (16 part) |          474.7           |       1.81       |       2.90       |       4.77       |       6.58       |
| **Hot Fund**     |    $c=1$    | Hash (32 part) |          462.6           |       1.75       |       3.03       |       6.42       |       8.22       |
| **Hot Fund**     |    $c=4$    | Unpartitioned  |          482.8           |       6.87       |      10.35       |      31.29       |      40.97       |
| **Hot Fund**     |    $c=4$    | Hash (16 part) |          537.8           |       6.90       |       9.18       |      11.56       |      12.03       |
| **Hot Fund**     |    $c=4$    | Hash (32 part) |          390.5           |      10.03       |      12.16       |      14.02       |      15.02       |
| **Hot Fund**     |    $c=8$    | Unpartitioned  |          381.2           |      20.41       |      25.22       |      34.06       |      41.14       |
| **Hot Fund**     |    $c=8$    | Hash (16 part) |          366.8           |      20.88       |      24.21       |      41.16       |      41.41       |
| **Hot Fund**     |    $c=8$    | Hash (32 part) |          412.1           |      19.15       |      22.84       |      25.85       |      27.51       |
| **Hot Fund**     |   $c=16$    | Unpartitioned  |          387.2           |      36.93       |      58.40       |      71.69       |      80.17       |
| **Hot Fund**     |   $c=16$    | Hash (16 part) |          384.2           |      40.16       |      43.90       |      51.65       |      53.58       |
| **Hot Fund**     |   $c=16$    | Hash (32 part) |          425.1           |      36.67       |      40.24       |      46.71       |      46.90       |
| **Spread Funds** |    $c=1$    | Unpartitioned  |          396.1           |       2.32       |       3.08       |       4.49       |      36.78       |
| **Spread Funds** |    $c=4$    | Unpartitioned  |       **1,487.8**        |       2.49       |       3.49       |       5.08       |       6.58       |
| **Spread Funds** |    $c=4$    | Hash (16 part) |         1,445.8          |       2.63       |       3.42       |       6.70       |       9.62       |
| **Spread Funds** |    $c=8$    | Unpartitioned  |       **2,059.9**        |       3.71       |       4.97       |       6.92       |       9.12       |
| **Spread Funds** |    $c=8$    | Hash (32 part) |         2,016.8          |       3.83       |       4.97       |       7.43       |       9.32       |
| **Spread Funds** |   $c=16$    | Unpartitioned  |       **2,127.5**        |       6.94       |      10.47       |      15.02       |      17.03       |
| **Spread Funds** |   $c=16$    | Hash (32 part) |       **2,210.4**        |       6.51       |       9.50       |      14.60       |      16.65       |

#### What limits these numbers:

1. **Single Hot Fund Throughput Bound:** Throughput for a single fund is strictly capped between **380 and 514 appends/sec**, regardless of client concurrency ($c=1$ through $c=16$). Under advisory locking, concurrent requests must wait in FIFO lock queue. Each append transaction holds the lock for ~1.8 ms to read the head, compute the next event, insert, and synchronously flush WAL on commit ($1 / 0.002\text{s} \approx 500\text{ appends/sec}$). Increasing concurrency merely increases queue wait time ($p50$ increases proportionally from 1.74ms at $c=1$ to 36.9ms at $c=16$). This serialization is essential to prevent sequence forks.
2. **Aggregate Multi-Fund Scaling:** When appends occur across independent funds, transactions acquire distinct 64-bit advisory lock keys and execute in parallel. Throughput scales linearly from **396 appends/sec at $c=1$** to **2,210 appends/sec at $c=16$** (5.6x throughput increase), enabled by PostgreSQL WAL group commit.

---

### 3.2. Hot-Fund Isolation Test (with Stated Bound)

To test whether a viral campaign on Fund A can cause head-of-line blocking or degrade latency on unrelated Fund B:
- **Background load:** 8 concurrent worker connections continuously hammered Fund A under maximum advisory lock contention.
- **Probe load:** An independent client executed 100 appends to Fund B.

| Metric                | Saturated Fund A (8 Workers) | Probed Fund B (Unpartitioned) | Probed Fund B (Hash-16 Partitioned) |
| :-------------------- | :--------------------------: | :---------------------------: | :---------------------------------: |
| **Appends Completed** |       203–204 appends        |          100 appends          |             100 appends             |
| **Throughput**        |      381.2 appends/sec       |     **395.2 appends/sec**     |        **368.7 appends/sec**        |
| **p50 Latency**       |           20.41 ms           |          **2.40 ms**          |             **2.57 ms**             |
| **p90 Latency**       |           25.22 ms           |          **3.22 ms**          |             **3.52 ms**             |
| **p99 Latency**       |           34.06 ms           |          **4.20 ms**          |             **4.80 ms**             |
| **Max Latency**       |           41.14 ms           |          **4.23 ms**          |             **5.24 ms**             |

> [!IMPORTANT]
> **Measured, not guaranteed.** While Fund A ran at p99 34.06 ms (max 41.14 ms), Fund B's append latency was p99 4.20 ms unpartitioned and 4.80 ms hash-partitioned, with a partitioned max of 5.24 ms. A different fund does not wait on Fund A's advisory lock, which is keyed by fund ID ([PostgreSQL Explicit Locking](../../docs/REFERENCES.md#pg-locking)). The latency figures are one run of 100 probe appends each, taken on a developer machine that was also running other builds and databases, and the partitioned run used 16 partitions, not the 32 decided in Decision 1. A p99 below 5 ms is what was observed, not a bound. Before relying on any latency target, rerun on a quiet machine with more samples and the 32-partition layout.

---

### 3.3. Index Plan and Query Plan Analysis for Read Shapes

We evaluated `EXPLAIN (ANALYZE, BUFFERS)` ([PostgreSQL EXPLAIN](../../docs/REFERENCES.md#pg-explain)) across the unpartitioned, 16-partition, and 32-partition hash layouts for the core access patterns:

#### Shape 1: Latest Event per Fund

```sql
SELECT * FROM fund_events WHERE fund_id = $1 ORDER BY seq DESC LIMIT 1;
```

- **Plan:** `Limit -> Index Scan Backward using fund_events_pkey on fund_events` (or target child partition).
- **Execution Time:** **0.017 ms** (Hash-32), **0.020 ms** (Hash-16), **0.024 ms** (Unpartitioned).
- **Buffer Hits:** Exactly **3 shared buffer hits**, 0 disk reads.
- **Finding:** PostgreSQL B-tree indexes support bidirectional traversal with equal efficiency. A separate descending index `(fund_id, seq DESC)` is completely redundant ([PostgreSQL CREATE INDEX](../../docs/REFERENCES.md#pg-index)).

#### Shape 2: Range by Sequence

```sql
SELECT * FROM fund_events WHERE fund_id = $1 AND seq BETWEEN 50 AND 150 ORDER BY seq ASC;
```

- **Plan:** `Index Scan using fund_events_pkey`.
- **Execution Time:** **0.036 ms** (Hash-32), **0.037 ms** (Hash-16), **0.049 ms** (Unpartitioned).
- **Buffer Hits:** **15–16 shared buffer hits**, 0 disk reads.
- **Finding:** Exact B-tree slice scan on the composite primary key.

#### Shape 3: Full Chain Scan for Verification

```sql
SELECT * FROM fund_events WHERE fund_id = $1 ORDER BY seq ASC;
```

- **Plan:** `Index Scan using fund_events_pkey`.
- **Execution Time:** **0.433 ms** (Hash-32), **0.677 ms** (Unpartitioned), **1.179 ms** (Hash-16).
- **Buffer Hits:** **73–129 shared buffer hits**.
- **Finding:** Streaming cursor reads directly from the B-tree in indexed sequence without sorting overhead.

#### Shape 4: Anchoring Batch Reads

- **Approach 4a (Per-Fund Checkpoint):**

  ```sql
  SELECT * FROM fund_events WHERE fund_id = $1 AND seq > $last_seq ORDER BY seq ASC LIMIT 100;
  ```

  - **Plan:** `Limit -> Index Scan using fund_events_pkey`.
  - **Execution Time:** **0.215 ms** (Hash-32), **0.297 ms** (Unpartitioned).
  - **Buffer Hits:** 71–130 buffer hits.
- **Approach 4b (Global Scan Across All Funds by Timestamp without Index):**

  ```sql
  SELECT * FROM fund_events WHERE occurred_at > $ts ORDER BY occurred_at ASC LIMIT 100;
  ```

  - **Execution Time:** **0.818 ms** (Unpartitioned), **1.466 ms** (Hash-16).
  - **Buffer Hits:** **226 to 317 buffer hits**.
  - **Critical Architectural Warning:** On a hash-partitioned table, any query lacking `fund_id` cannot perform partition pruning. It must scan **all 32 partitions** and execute an `Append` / `Merge Append` across child partition indexes.

---

### 3.4. Chain Verification Cost at 1,000,000 Events

Using `verifyChainStream` from `@yen/eventlog` with synthetic events generated by `makeNextEvent`:

> **Superseded end-to-end measurements.** These are from the earlier script, which measured synthetic-event hashing and verification together. The duration and throughput columns are combined generation-plus-verification figures; they are not verification-only measurements. The 1,000,000-event row is retained as a historical result only. The current script measures generation and verification separately, but no current 1,000,000-event measurement has been run.

| Total Events  | Combined Duration: Generation + Verification (s) | Combined Throughput (ev/s) | Combined Latency per Event (µs) | Peak HeapUsed (MB) | Heap Delta (MB) | Peak RSS (MB) | Verification Status |
| :-----------: | :----------------------------------------------: | :------------------------: | :-----------------------------: | :----------------: | :-------------: | :-----------: | :-----------------: |
|   **1,000**   |                     0.165 s                      |          6,052.5           |            165.2 µs             |      11.60 MB      |    +0.50 MB     |   83.82 MB    |     `ok: true`      |
|  **10,000**   |                     1.713 s                      |          5,838.6           |            171.3 µs             |      14.98 MB      |    +0.00 MB     |   84.22 MB    |     `ok: true`      |
|  **100,000**  |                     16.190 s                     |          6,176.8           |            161.9 µs             |      22.18 MB      |    +10.52 MB    |   97.68 MB    |     `ok: true`      |
| **1,000,000** |                  **188.884 s**                   |        **5,294.3**         |          **188.9 µs**           |    **34.97 MB**    |  **+19.14 MB**  | **122.71 MB** |   **`ok: true`**    |

#### Limiting factors:

1. **Streaming memory behavior:** `verifyChainStream` consumes an `AsyncIterable`, so it does not need to retain the full chain. The earlier combined-run measurement recorded a 34.97 MB peak heap at 1,000,000 events; re-measure with the current script before treating that value as a verification-only memory result.
2. **Compute profile:** The earlier combined run recorded about 5,300 to 6,200 events/sec, including synthetic-event generation. It does not establish verification-only throughput or a current CPU profile. The prior profile attributed CPU time to:
   - RFC 8785 canonical JSON sorting and character escaping (~45% CPU) ([RFC 8785](../../docs/REFERENCES.md#rfc-8785)).
   - WebCrypto SHA-256 digest computation (~40% CPU).
   - Zod schema and regex validation (~15% CPU).
3. **Audit Time:** The earlier end-to-end run took 188.884 seconds to generate and verify 1,000,000 events together. It does not establish verification-only audit time. For donor-facing verification badges, donors verify the authenticated prefix from the latest checkpoint rather than replaying from genesis on every page load.

---

## 4. Decisions

### Decision 1: Hash Partitioning by `fund_id` with 32 Partitions on Day 1

We decide to define `fund_events` as a **declarative hash-partitioned table by `fund_id` with 32 partitions** (`MODULUS 32, REMAINDER 0..31`) from Day 1:
1. **Constraint Compatibility:** PostgreSQL requires that any unique or primary key constraint on a partitioned table include all partition key columns ([PostgreSQL Table Partitioning](../../docs/REFERENCES.md#pg-partition); [PostgreSQL Constraints](../../docs/REFERENCES.md#pg-constraints)). The primary key `(fund_id, seq)` includes `fund_id`, satisfying this constraint natively.
2. **Foreign Key Support:** PostgreSQL 16 fully supports foreign key constraints on partitioned tables referencing `funds(id)`, as verified in our container tests.
3. **Partition Capacity:** At 32 partitions, a monorepo holding 100,000,000 events across 10,000 funds holds an average of 3.1M events (~750 MB) per partition table and B-tree index. This keeps B-tree depths at $\le 3$ and ensures autovacuum operations run concurrently per partition without locking the entire event store.
4. **Online Modulus Doubling Expansion Plan:** Because PostgreSQL hash partitioning uses modulus arithmetic ($h \pmod M = r$), modulus expansion follows powers of two ($M \to 2M$). To scale from 32 to 64 partitions without table-wide rewrites:
   - For any partition $r$, detach it concurrently: `ALTER TABLE fund_events DETACH PARTITION fund_events_p{r} CONCURRENTLY;`
   - Split $p{r}$ rows into two new tables: `fund_events_p{r}_new` (`MODULUS 64, REMAINDER r`) and `fund_events_p{r+32}` (`MODULUS 64, REMAINDER r+32`).
   - Attach both partitions: `ALTER TABLE fund_events ATTACH PARTITION ...`
   - **Crucially:** The other 31 partitions remain 100% online for live reads and appends with zero downtime and zero data rewrite.
5. **What the measurements do and do not support:** Partitioning did not make appends faster. Fund B p99 was 4.20 ms unpartitioned and 4.80 ms partitioned, within the noise of one run. The case for partitioning is capacity and maintenance (smaller indexes, per-partition autovacuum, a path to archiving), not speed. A single table with `PRIMARY KEY (fund_id, seq)` would serve the measured workload; the cost of choosing it is that moving to partitions later means rewriting a table that anchored roots already refer to. The maintainers should decide this knowingly.
6. **Immutability must be re-applied per partition.** A statement-level `BEFORE TRUNCATE` trigger on the partitioned parent does not fire for `TRUNCATE` run directly on a child partition. This was verified on PostgreSQL 16: `TRUNCATE parent` was blocked, `TRUNCATE parent_p0` succeeded and removed rows. The migration therefore has to create the `no_truncate` trigger on every partition (see section 5), and the tests must truncate a partition directly as the application role and as the table owner.

### Decision 2: The insert trigger reads the head from the parent table

A `BEFORE INSERT ... FOR EACH ROW` trigger on a partitioned table fires after the row has been routed to its partition. An earlier draft of this ADR claimed that querying `fund_events` inside the trigger failed because the tuple was not visible, and so required dynamic SQL on `TG_TABLE_NAME`. That claim was wrong. It was checked directly on PostgreSQL 16 with a hash-partitioned table: three inserts for one fund in a single transaction, each reading `SELECT seq FROM parent WHERE fund_id = NEW.fund_id ORDER BY seq DESC LIMIT 1` in the trigger, were sequenced correctly, and a later insert with a gap was rejected. Partition pruning limits the lookup to the one partition that holds the fund. The trigger function therefore stays as written in migration 0003, with no dynamic SQL.

### Decision 3: Index Plan Standardized on `PRIMARY KEY (fund_id, seq)`

No secondary index shall be created for fund event ordering.
- `PRIMARY KEY (fund_id, seq)` serves:
  - Latest event lookup via `ORDER BY seq DESC LIMIT 1` (Backward Index Scan: 0.017 ms).
  - Sequence ranges via `seq BETWEEN $1 AND $2` (Index Scan: 0.036 ms).
  - Verification stream via `ORDER BY seq ASC` (Index Scan: 0.433 ms).
- Creating a separate index on `(fund_id, seq DESC)` is explicitly rejected as waste of disk space and write I/O.

### Decision 4: Anchoring Batch Read Architecture (No Whole-Table Scans)

Because hash partitioning distributes rows by `fund_id`, any query filtering by global timestamp (`occurred_at > $ts`) must scan all 32 partitions.
We decide that anchoring must never perform whole-table timestamp scans. Instead, anchoring must use either:
1. **Per-fund checkpointing:** `WHERE fund_id = $1 AND seq > $last_anchored_seq ORDER BY seq ASC LIMIT $batch`, which uses the primary key index scan on exactly 1 partition (0.215 ms, 71 buffer hits).
2. **Transactional Outbox / Pending Anchor Table:** Staged in the same transaction as `appendEvent` ([Transactionally Staged Job Drains in Postgres](../../docs/REFERENCES.md#brandur-job-drain); YEN-62):

   ```sql
   CREATE TABLE fund_anchor_pending (
     fund_id uuid PRIMARY KEY REFERENCES funds(id),
     last_seq bigint NOT NULL,
     updated_at timestamptz NOT NULL
   );

   CREATE TABLE fund_anchor_state (
     fund_id uuid PRIMARY KEY REFERENCES funds(id),
     anchored_seq bigint NOT NULL,
     updated_at timestamptz NOT NULL
   );
   ```

   An anchor worker joins pending work to the last successfully anchored sequence:

   ```sql
   SELECT p.fund_id, p.last_seq
   FROM fund_anchor_pending AS p
   LEFT JOIN fund_anchor_state AS a USING (fund_id)
   WHERE p.last_seq > COALESCE(a.anchored_seq, 0);
   ```

   After anchoring `last_seq`, the worker advances `fund_anchor_state.anchored_seq` transactionally. This avoids referencing an undefined column and completely avoids table scans over `fund_events`.

### Decision 5: Retention and Cold-Storage Archival

Yen is a public transparency ledger:
1. **Zero Deletion Policy:** Direct `UPDATE`, `DELETE`, and `TRUNCATE` operations are rejected by database triggers and revoked from all application roles ([PostgreSQL CREATE TRIGGER](../../docs/REFERENCES.md#pg-trigger); [PostgreSQL Privileges](../../docs/REFERENCES.md#pg-privileges)).
2. **Cold Storage Strategy (not decided here):** Under hash partitioning a partition holds many funds, so detaching one partition would archive a slice of every fund, including active ones. Whole-partition detach is therefore not an archival tool for closed funds. Archiving closed funds needs either a copy of their rows to object storage with the original rows kept (nothing is deleted), or a different partitioning key. Decide this when retention is first needed, and keep it out of the migration for now. Object storage with a retention lock is the likely home for copies, to be confirmed against the provider chosen.
3. **Verification Decoupling:** Verification against on-chain checkpoints only requires streaming raw event envelopes. Because `verifyChainStream` operates on any `AsyncIterable`, auditors can verify cold-storage files directly in Node or the browser without placing any query load on PostgreSQL.
4. **Online Operational State:** PostgreSQL only needs to retain active fund events and the current `ChainHead` checkpoint state.

---

## 5. Concrete Recommended DDL for `0003_fund_events.sql`

To apply these findings to the in-flight migration, update `packages/db/migrations/0003_fund_events.sql` as follows:

```sql
-- 1. Replace single table with 32-way hash partitioned table
CREATE TABLE fund_events (
  fund_id uuid NOT NULL REFERENCES funds(id),
  seq bigint NOT NULL CHECK (seq >= 1),
  type text NOT NULL,
  version integer NOT NULL CHECK (version = 1),
  actor text NOT NULL CHECK (actor ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  occurred_at text NOT NULL CHECK (occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  payload jsonb NOT NULL,
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  canonical_envelope text NOT NULL,
  PRIMARY KEY (fund_id, seq)
) PARTITION BY HASH (fund_id);

-- 2. Create 32 partitions (MODULUS 32, REMAINDER 0..31)
DO $$
BEGIN
  FOR r IN 0..31 LOOP
    EXECUTE format('CREATE TABLE fund_events_p%s PARTITION OF fund_events FOR VALUES WITH (MODULUS 32, REMAINDER %s);', r, r);
  END LOOP;
END;
$$;

-- 3. yen_fund_events_before_insert() is unchanged: it reads the head from the parent table
--    (see Decision 2).

-- 4. Row-level triggers on the parent are cloned to every partition. The statement-level
--    TRUNCATE trigger is NOT, so it is also created on each partition below.
CREATE TRIGGER fund_events_before_insert
BEFORE INSERT ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_before_insert();

CREATE TRIGGER fund_events_no_update
BEFORE UPDATE ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_no_update();

CREATE TRIGGER fund_events_no_delete
BEFORE DELETE ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_no_delete();

CREATE TRIGGER fund_events_no_truncate
BEFORE TRUNCATE ON fund_events
FOR EACH STATEMENT
EXECUTE FUNCTION yen_fund_events_no_truncate();

-- 5. Re-apply the TRUNCATE guard on every partition (statement triggers are not cloned).
DO $$
BEGIN
  FOR r IN 0..31 LOOP
    EXECUTE format(
      'CREATE TRIGGER fund_events_no_truncate BEFORE TRUNCATE ON fund_events_p%s FOR EACH STATEMENT EXECUTE FUNCTION yen_fund_events_no_truncate();', r);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON fund_events_p%s FROM PUBLIC;', r);
  END LOOP;
END;
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON fund_events FROM PUBLIC;
```

---

## 6. Consequences

### Positive

- **High Concurrency Scalability:** Multi-fund append throughput scales to 2,210+ appends/sec under group commit.
- **Isolation (measured):** In one run, hot-fund traffic did not slow an unrelated fund beyond about 5 ms at p99; see the caveats in section 3.2.
- **Partition Maintenance:** Autovacuum, index bloat, and cache locality are partitioned into manageable ~750MB chunks.
- **Integrity enforced in the database:** Triggers, canonical serialization, and SHA-256 verification run inside the insert transaction. With partitioning, the TRUNCATE guard has to be re-applied on each partition.
- **Client Auditability:** Streaming verification avoids retaining the full chain. The cited ~3 minute and <35 MB figures are from a superseded end-to-end run that included event generation; they are not current verification-only performance claims.

### Negative / Trade-offs

- **Single Hot Fund Throughput Ceiling:** A single viral fund cannot exceed ~400–500 appends/sec due to advisory lock serialization and synchronous WAL flush. Applications handling viral donation drives must use client-side aggregation or batching if a single fund requires thousands of donations per second.
- **No speed gain from partitioning:** the measured append latency is the same or slightly worse; see Decision 1, item 5.
- **Multi-Partition Catalog:** 32 child partitions increase PostgreSQL catalog entry count and require partition pruning for query efficiency. Cross-partition global queries must be avoided.

---

## 7. References

All external design claims cite verified entries in [docs/REFERENCES.md](../../docs/REFERENCES.md):
- [PostgreSQL Table Partitioning](../../docs/REFERENCES.md#pg-partition)
- [PostgreSQL Explicit Locking](../../docs/REFERENCES.md#pg-locking)
- [PostgreSQL Constraints](../../docs/REFERENCES.md#pg-constraints)
- [PostgreSQL CREATE INDEX](../../docs/REFERENCES.md#pg-index)
- [PostgreSQL EXPLAIN](../../docs/REFERENCES.md#pg-explain)
- [PostgreSQL CREATE TRIGGER](../../docs/REFERENCES.md#pg-trigger)
- [PostgreSQL Privileges](../../docs/REFERENCES.md#pg-privileges)
- [PostgreSQL Transaction Isolation](../../docs/REFERENCES.md#pg-isolation)
- [Transactionally Staged Job Drains in Postgres](../../docs/REFERENCES.md#brandur-job-drain)
- [RFC 8785: JSON Canonicalization Scheme](../../docs/REFERENCES.md#rfc-8785)
- [Crosby and Wallach: Efficient Data Structures for Tamper-Evident Logging](../../docs/REFERENCES.md#crosby-wallach)
- [Schneier and Kelsey: Secure Logs on Untrusted Machines](../../docs/REFERENCES.md#schneier-kelsey)
- [Brendan Gregg: The USE Method](../../docs/REFERENCES.md#gregg-use)
