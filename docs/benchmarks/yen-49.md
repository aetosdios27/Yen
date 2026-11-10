# YEN-49 operation cost evidence

The growing cost was in product admission queries and the deferred journal constraint, not the runner's batch invariant query. The fix indexes each journal and maintains account entry totals and nonexpiring pending-hold totals in the writer's transaction. Expiring holds retain an indexed time-dependent query. The runner keeps its original batch verification and final full verification, and additionally checks projected balances against its operation model after every batch.

A million-operation pass is **not established by this report yet**. Contended wall times are excluded from performance conclusions. Timed comparisons and the full pass require `/proc/loadavg`'s one-minute value below 8; every retained timing must have an adjacent load snapshot. This is the operator's measurement gate, not a performance assertion.

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

Subtracting its progress timestamps gives 93.1 seconds for operations 45,000–50,000 and 161.1 seconds for 95,000–100,000. These CI observations cannot calibrate a hosted-million budget against contended local times. Daily scheduling therefore stays at its existing count; a weekly million run has a 330-minute ceiling without claiming a completed hosted pass.

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
