# YEN-49 operation cost evidence

The growing cost was in product admission queries and the deferred journal constraint, not the runner's batch invariant query. The fix indexes each journal and maintains account entry totals and nonexpiring pending-hold totals in the writer's transaction. Expiring holds retain an indexed time-dependent query. The runner keeps its original batch verification and final full verification, and additionally checks projected balances against its operation model after every batch.

The full single-fund run completed locally on product head `5546e1a5a113a27723b8b652fedfbcfc3c03efb5` with the original final chain/raw-sum verification and zero invariant violations:

```text
result ops=1000000 seed=3942630993 donations=799018 holds=200982 duration=3797.10s ops_per_sec=263.36 violations=0
```

Command: `node packages/ledger/scripts/invariants-load.mjs --ops 1000000 --seed 3942630993 --batch 100`. The [complete result and load log](yen-49-million.txt) records every progress/result checkpoint. The [timing TSV](yen-49-timing.tsv) records every 5,000-operation window, including both repeated comparisons. Node was v24.21.0 (`node --version`) and Postgres was 16.15 (`SHOW server_version`). All recorded one-minute loads for the million pass were 1.08–3.22, below the operator's gate of 8. The wrapper read `/proc/loadavg` immediately before starting and beside every progress/result line, terminating if the gate was exceeded.

Operation generation took 3551.0 seconds; the remaining 246.10 seconds performed the final verification. Median seconds per 5,000 operations by successive quarters of the million pass were 16.7, 16.9, 17.8 and 18.9. Window range was 16.2–25.2 seconds. This is modest index/write cost growth rather than a history scan proportional to fund size. These statistics are calculated from the TSV's `window_s` column in consecutive groups of 50 rows.

The local timing connection retained `pg_stat_statements.track=all` from the server's startup option. `SHOW pg_stat_statements.track` confirmed this after the pass: an attempted `ALTER SYSTEM` setting was overridden by startup configuration. Both timing sides and the million pass used the same SQL-accounting setting. The Node CPU profiler was off. These are measured instrumented runtimes, not uninstrumented throughput claims.

The interleaved low-load comparison ran `node packages/ledger/scripts/invariants-load.mjs --ops 20000 --seed 3942630993 --batch 100` twice per side on fresh schemas, using an isolated build of base `9534a88` and this PR's product build:

| Code   | Repeat | Successive 5k windows, seconds | Full result, seconds |
| ------ | -----: | ------------------------------ | -------------------: |
| before |      1 | 18.7, 24.5, 27.5, 32.8         |               108.45 |
| after  |      1 | 17.3, 16.4, 16.8, 18.5         |                74.58 |
| before |      2 | 18.7, 23.2, 31.3, 32.1         |               110.50 |
| after  |      2 | 19.9, 17.1, 22.3, 16.7         |                80.84 |

Each full result had zero violations. All observed load snapshots for these comparisons are in the TSV. Early contended timings are rejected as comparative evidence. The required original repeated observations were 259.82 and 151.89 seconds at 20k operations, and 482.95 and 683.46 seconds at 40k, using the same runner command with those `--ops` values on fresh schemas; no exact adjacent load snapshot was captured for those early observations.


All data below was measured locally. Each diagnostic fixture has one fund and starts with the specified count of balanced entries plus nonexpiring pending holds. It then executes exactly 4,000 donations and 1,000 holds through the product API in transactions of 100 operations. This controlled cost probe is not a randomized invariant-pass claim. Its synthetic history is not an event replay fixture.

| Initial entries | Journal check buffer hits before / after | Donation admission buffer hits before / after | Hold admission buffer hits before / after |
| --------------: | ---------------------------------------: | --------------------------------------------: | ----------------------------------------: |
|          10,000 |                       1,394,880 / 24,098 |                              789,690 / 29,485 |                           197,374 / 7,651 |
|          50,000 |                       5,345,760 / 24,098 |                            3,011,941 / 30,634 |                          752,936 / 10,241 |
|         100,000 |                      10,283,520 / 32,100 |                            5,789,704 / 25,163 |                        1,447,377 / 11,607 |

These are `pg_stat_statements` deltas for each 5,000-operation window after resetting statistics following fixture setup. Journal checks execute 8,000 times (twice per donation); donation admission executes 4,000 times; hold admission executes 1,000 times. Each returns one row per call. **Returned rows are not scanned rows.** All listed statements had zero shared-block reads: the buffer hits show logical work even with a warm cache. The journal index adds a tree level at the largest size; it does not scan history. Admission work no longer grows proportionally with entry or nonexpiring-hold history. Expiring-hold work remains proportional to matching expiring holds.

`EXPLAIN (ANALYZE, BUFFERS)` separately shows the journal query scanning the entire entry table before the fix and just the journal's two entries afterward. The old entry sum scans history; the new total read visits a fixed-size account projection. The old pending-hold sum scans the pending-hold history; the new expiration-range query visits no nonexpiring holds. The runner's batch query uses the sequence index and returns the same bounded batch at every fixture size. The checked-in [JSON evidence](yen-49-cost.json) contains scan nodes, estimated costs, buffer counters, statement texts and load snapshots; elapsed plan timings are deliberately omitted.

Commands used for these local counters and plans:

```sh
podman run -d --rm --name yen-pg-55549 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=yen -e POSTGRES_DB=yen \
  -p 55549:5432 docker.io/library/postgres:16 \
  -c shared_preload_libraries=pg_stat_statements \
  -c pg_stat_statements.track=all
export YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen

# Before: process loaded the original compiled product before the patch was applied.
# Schema and migrations were frozen before introducing migration 0034.
node packages/ledger/scripts/invariants-cost.mjs before /tmp/yen49-evidence/cost \
  /tmp/yen49-evidence/old-schema.sql /tmp/yen49-evidence/old-migrations
# After: rebuilt product with the patch and projection triggers.
pnpm exec turbo run build --filter=@yen/ledger...
node packages/ledger/scripts/invariants-cost.mjs after /tmp/yen49-evidence/cost
```

To reproduce the before side, build the original product on base `9534a88fdb88286101c4ee9647d585223eea2873`, copy the probe into its ledger scripts directory, and supply that checkout's ledger schema and migration directory. The before process must load the original dependency and original product, not the patched product with an old schema. The probe **drops the disposable database's public schema**. Statistics are filtered by database, so separate correctness-test databases do not contribute. The hot statements' captured calls equal their expected operation counts; unrelated statement-statistics entries can be evicted, so this report does not claim a complete count of every internal SQL statement.

The Node CPU profile was taken separately from comparative timing with:

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen \
  node --cpu-prof --cpu-prof-dir=/tmp/yen49-evidence \
  packages/ledger/scripts/invariants-load.mjs --ops 1000 --seed 3942630993 --batch 100
```

Its 24,800 samples included 16,982 idle samples. This supports waiting on the database; the statement plans and buffer counts identify the growing work. The profile's elapsed time is not a benchmark result. Original repeated baselines ran `node packages/ledger/scripts/invariants-load.mjs --ops 20000` and `--ops 40000`, both with `--seed 3942630993 --batch 100`, twice on fresh schemas. Their contended times are discarded, and exact adjacent load snapshots were not collected for each of those early observations. No speedup is inferred from them.

Evidence **read from CI**, not measured locally:

```sh
gh run view 42597336657 --log
```

That log contains:

```text
result ops=100000 seed=3942630993 donations=80097 holds=19903 duration=1984.91s ops_per_sec=50.38 violations=0
```

Subtracting its progress timestamps gives 93.1 seconds for operations 45,000–50,000 and 161.1 seconds for 95,000–100,000. The daily job now runs one million operations with a 330-minute timeout; manual 100k runs retain 90 minutes. This is below the supplied hosted-runner ceiling of 360 minutes. The budget uses the faster local old-code repetition to avoid understating the hosted slowdown:

```python
slowdown = 1984.91 / (108.45 * 5)             # 3.660507; old CI 100k / local old 20k scaled to 100k
hosted_minutes = 3797.10 * slowdown / 60      # 231.655195, planning estimate
planning_minutes = hosted_minutes * 1.25 + 10 # 299.568993, chosen 25% padding plus 10 minutes setup/restore
```

That leaves about 30 minutes beyond the padded plan within the 330-minute job limit. This is a conservative scheduling model, **not a measured hosted-million result**. The normalization also includes the old code's extra growth at CI's larger dataset. Local SQL accounting was enabled; the hosted service's default configuration differs. The next scheduled main run establishes the hosted result. The workflow regression was red while the scheduled default was smaller, then green after promotion.


Local correctness commands:

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen \
  pnpm --filter @yen/ledger exec vitest run src/schema.plan.test.ts
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen pnpm --filter @yen/ledger test
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen pnpm --filter @yen/db test
node --test .github/scripts/nightly-workflow.test.mjs
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen pnpm verify
```

The journal budget regression was red at estimated cost 2982.02 against a budget below 20, then green. The projection test was red without the new function and is green with rollback, deferred rejection of an unbalanced journal, hold state/expiry changes and deletion. The real database suite passed 368 tests; the ledger suite passed 85 tests with 2 pre-existing opt-in skips. Both new ledger tests run against real Postgres. The weekly workflow test was red, then all 3 workflow tests passed. Full verification passed all 39 tasks on committed head `cd3c640`.

A separate correctness-only run on `yen49_correctness` used:

```sh
cat /proc/loadavg
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55549/yen49_correctness \
  node packages/ledger/scripts/invariants-load.mjs --ops 5000 --seed 3942630993 --batch 100
cat /proc/loadavg
```

It reported `ops=5000 seed=3942630993 donations=4025 holds=975 violations=0`. Load snapshots were `26.21 25.32 24.46` before and `19.49 23.91 24.05` after. Its elapsed duration is discarded as performance evidence. This verifies the added batch-model checks and the original full chain/raw-sum verification; it is not the missing million-operation pass.

After the full pass, an independent query on `yen49_timed` confirmed one fund, 2,000,000 events, 799,018 journals, 200,982 holds and 1,598,036 entries:

```sql
SELECT (SELECT COUNT(*) FROM funds) AS funds,
  (SELECT COUNT(*) FROM fund_events) AS events,
  (SELECT COUNT(*) FROM konto_journals) AS donations,
  (SELECT COUNT(*) FROM konto_holds) AS holds,
  (SELECT COUNT(*) FROM konto_entries) AS entries;
```

The existing restore drill also passed after the projection change: source and restored databases both verified 4 funds and 3 anchors. Command: `PATH=/tmp/yen49-evidence/pg16-bin:$PATH YEN_RESTORE_ADMIN_URL=postgres://postgres:yen@127.0.0.1:55549/yen pnpm --filter @yen/ledger backup:restore`. Each PG16 client wrapper runs `podman run --rm -i --network host postgres:16 <tool> "$@"`, reusing the assigned server port. The owner's runbook is unchanged.
