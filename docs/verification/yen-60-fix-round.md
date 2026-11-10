# YEN-60 fix-round evidence

The inherited PR already instruments the API/ledger money routes, burn arithmetic,
trace propagation, public probe and exporter privacy. This round closes the
verifier's nine implementation gaps without claiming hosted alert delivery.

| Item | Status | Behavior and regression test |
| --- | --- | --- |
| 1 | fixed | `sampler-plans.test.ts`: four registered sampler statements pass the existing YEN-57 `verifyPlanNode` cost/scan/index gate on realistic fixtures; `sampler-singleton.test.ts`: two runtimes share one serial cron schedule |
| 2 | fixed | `sampler-failure.test.ts`: fail each of four statements, export the failure counter, preserve the other objectives, log safe diagnostics |
| 3 | fixed | `envelope.test.ts`: dead-letter reader gets original payload; handler decoding uses the same unwrap function |
| 4 | fixed | `boss.test.ts`: ECONNREFUSED name/code survive, personal error message does not |
| 5 | fixed | `telemetry.test.ts`: exported name is database.client_connections, matching pg_stat_activity scope |
| 6 | fixed | `append-objective.test.ts`: invalid caller input and unknown fund are good responses, corrupt stored head is bad; shared telemetry test checks both classifier outcomes |
| 7 | fixed | `browser-tracing.test.ts`: valid request/trace ids and <1500-byte minified browser helper; expense-postgres test preserves the single trace |
| 8 | fixed | merged origin/main (through #152) cleanly; inspected #135 without editing its branch |
| 9 | fixed | separate SLO counter, trace propagation, redaction and event-loop tests; injected histogram + fake timer checks interval/reset/final flush |

Red runs were executed before the corresponding implementation (or with that
specific implementation restored to the inherited version). Local logs:
`/tmp/yen-red-{plans,anchor-index,singleton,sampler,envelope,boss,metric-name,append,objective,browser-budget,loop}.log`.
The loop's red test fails at the missing injected reset; the green test asserts
exported histogram min=60, max=80 and count=2, with no wall-clock sleeps/retries.

## Query plans

Real Postgres 16 on port 55560. Test fixture: four funds, 50,000 events per fund,
199,996 confirmed anchors, 200,000 pledges (200 outstanding), and 200,000 real
pg-boss jobs (200 outstanding). The event insertion trigger is disabled only
for synthetic plan-fixture insertion: hashes/payload bodies are placeholders;
these plans do not establish event-chain correctness. Existing functional DB
suites cover valid appends. Results return four lag rows and 200 outstanding jobs.

`YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55560/yen pnpm --filter @yen/queue exec vitest run --silent=false src/sampler-plans.test.ts`

Old versus new anchor statement on exactly the same fixture and indexes (one
EXPLAIN ANALYZE run, not a production speedup claim; machine also ran CPU load).
The structural result is 200,000 correlated lookups versus four index lookups.

```text
before_same_fixture HashAggregate  (cost=174013.64..174013.72 rows=4 width=48) (actual time=1778.508..1778.513 rows=4 loops=1)
  Group Key: e.fund_id
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=801819 read=5078
  ->  Seq Scan on fund_events e  (cost=0.00..173346.97 rows=66667 width=41) (actual time=506.812..1778.379 rows=4 loops=1)
        Filter: (seq > COALESCE((SubPlan 2), '0'::bigint))
        Rows Removed by Filter: 199996
        Buffers: shared hit=801819 read=5078
        SubPlan 2
          ->  Result  (cost=0.81..0.82 rows=1 width=8) (actual time=0.008..0.008 rows=1 loops=200000)
                Buffers: shared hit=799992 read=8
                InitPlan 1 (returns $1)
                  ->  Limit  (cost=0.42..0.81 rows=1 width=8) (actual time=0.008..0.008 rows=1 loops=200000)
                        Buffers: shared hit=799992 read=8
                        ->  Index Only Scan using anchors_confirmed_head_idx on anchors a  (cost=0.42..19487.52 rows=49999 width=8) (actual time=0.007..0.007 rows=1 loops=200000)
                              Index Cond: ((fund_id = e.fund_id) AND (to_seq IS NOT NULL))
                              Heap Fetches: 200000
                              Buffers: shared hit=799992 read=8
Planning:
  Buffers: shared hit=88 read=7
Planning Time: 1.038 ms
JIT:
  Functions: 15
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 0.652 ms, Inlining 0.000 ms, Optimization 0.486 ms, Emission 11.335 ms, Total 12.474 ms
Execution Time: 1805.606 ms
```

```text
anchors Nested Loop  (cost=1.23..12.18 rows=4 width=32) (actual time=0.090..0.186 rows=4 loops=1)
  Buffers: shared hit=26 read=7
  ->  Seq Scan on funds f  (cost=0.00..1.04 rows=4 width=16) (actual time=0.011..0.013 rows=4 loops=1)
        Buffers: shared hit=1
  ->  Limit  (cost=1.23..2.75 rows=1 width=33) (actual time=0.036..0.036 rows=1 loops=4)
        Buffers: shared hit=25 read=7
        InitPlan 1 (returns $1)
          ->  Limit  (cost=0.42..0.81 rows=1 width=8) (actual time=0.017..0.017 rows=1 loops=4)
                Buffers: shared hit=16
                ->  Index Only Scan using anchors_confirmed_head_idx on anchors  (cost=0.42..19362.52 rows=49999 width=8) (actual time=0.017..0.017 rows=1 loops=4)
                      Index Cond: (fund_id = f.id)
                      Heap Fetches: 4
                      Buffers: shared hit=16
        ->  Index Scan using fund_events_pkey on fund_events  (cost=0.42..25396.84 rows=16667 width=33) (actual time=0.017..0.017 rows=1 loops=4)
              Index Cond: ((fund_id = f.id) AND (seq > COALESCE($1, '0'::bigint)))
              Buffers: shared hit=9 read=7
Planning Time: 0.257 ms
Execution Time: 0.217 ms
```

```text
pending Aggregate  (cost=0.24..0.26 rows=1 width=32) (actual time=0.056..0.056 rows=1 loops=1)
  Filter: (count(*) > 0)
  Buffers: shared hit=2
  ->  Limit  (cost=0.14..0.23 rows=1 width=8) (actual time=0.042..0.042 rows=1 loops=1)
        Buffers: shared hit=2
        ->  Index Only Scan using donation_pledges_unverified_age_idx on donation_pledges  (cost=0.14..18.34 rows=213 width=8) (actual time=0.041..0.041 rows=1 loops=1)
              Heap Fetches: 1
              Buffers: shared hit=2
Planning Time: 0.135 ms
Execution Time: 0.082 ms
```

```text
depth Aggregate  (cost=389.51..389.52 rows=1 width=8) (actual time=0.333..0.334 rows=1 loops=1)
  Buffers: shared hit=201
  ->  Index Only Scan using job_common_i14 on job_common job  (cost=0.14..388.96 rows=220 width=0) (actual time=0.025..0.315 rows=200 loops=1)
        Filter: (state = ANY ('{created,retry,active}'::telemetry_plans.job_state[]))
        Heap Fetches: 200
        Buffers: shared hit=201
Planning:
  Buffers: shared hit=13
Planning Time: 0.209 ms
Execution Time: 0.350 ms
```

```text
connections Aggregate  (cost=2.42..2.43 rows=1 width=8) (actual time=0.076..0.077 rows=1 loops=1)
  Buffers: shared hit=1
  ->  Nested Loop  (cost=0.00..2.42 rows=1 width=0) (actual time=0.071..0.073 rows=1 loops=1)
        Join Filter: (d.oid = s.datid)
        Buffers: shared hit=1
        ->  Function Scan on pg_stat_get_activity s  (cost=0.00..1.25 rows=1 width=8) (actual time=0.058..0.059 rows=1 loops=1)
              Filter: (backend_type = 'client backend'::text)
              Rows Removed by Filter: 5
        ->  Seq Scan on pg_database d  (cost=0.00..1.15 rows=1 width=4) (actual time=0.012..0.012 rows=1 loops=1)
              Filter: (datname = current_database())
              Rows Removed by Filter: 9
              Buffers: shared hit=1
Planning Time: 0.204 ms
Execution Time: 0.106 ms
```

Before any new index, the old statement on 200,000 events/four anchors took
433.751 ms, touched 206,897 shared buffers and ran its subquery 200,000 times.
The redesigned pledge lookup without its partial index still cost 5119 and
scanned 200,000 rows (12.567 ms); this is why migration 0034 adds an age index.
Removing only anchors_confirmed_head_idx on the large-anchor fixture costs
24822.33 versus the 10000 gate and fails the expected-index check. No event or
pg-boss index was added. Queue depth uses pg-boss's existing job state index.

Production replica count is not declared: docker-compose has no worker service,
and packages/queue/src/cli.ts constructs one runtime per process. A database/schema
pg-boss minute cron and singleton queue avoid relying on a one-process assumption.
Failure alert rationale and counter names are in docs/slo.md.

## Browser build

For each side: `pnpm --filter @yen/shared build && pnpm --filter @yen/web build`.
Only browser-tracing.ts and the web fetch call were restored for the baseline;
all other source and build configuration were identical. Count unique JS chunks
from the approval page client-reference manifest plus rootMainFiles in its
build manifest, using filesystem byte sizes (uncompressed, no source maps).

789385 bytes before, 741746 after, 47639 bytes removed (ten chunks each).
The esbuild helper budget separately guards against SDK/exporter reintroduction.
No issue requirement calls for browser-side span export: backend spans adopt
its random W3C parent, while the request UUID remains correlated end to end.

## Stress command

Four `node -e 'for (;;) Math.sqrt(Math.random())'` processes ran concurrently
with this shell loop; a trap killed all four on completion:

```sh
for n in $(seq 1 200); do
  pnpm --filter @yen/shared exec vitest run src/telemetry.test.ts src/event-loop.test.ts > /tmp/yen-stress/run-$n.log 2>&1 || exit 1
done
```

200/200 invocations passed, zero failures. Each invocation runs the separated
counter, trace, redaction, fault-classifier and event-loop tests. Logs are in
/tmp/yen-stress. The initial concurrent whole-repo run exceeded an unrelated
web axe test's existing five-second deadline; no deadline/assertion was changed.
Final whole-repo verification runs after the stress burners exit.

## Integration and operator boundary

#135 adds createJobContext, withJobContext and completion/failure logs at the
handler call. Whoever merges second should keep decoding at job construction,
then compose `traceJob(carrier, () => withJobContext(context, () => handler(job)))`
inside its existing try/catch, retaining #135's outcome logs. Our wrapper adds no
second handler loop or competing context store.

The release.yml failure on the inherited head has no jobs: invalid job-level
runner.temp expressions (lines 22/86/127). It is inherited from main; the director
assigned it to another owner. This PR does not change release.yml beyond the
requested merge of main, and that workflow is not a required check.

Operators still must deploy collectors, provision alerts/dashboards and schedule
the public-page probe. Production PIN notifications remain a memory adapter;
durable notification delivery and the literal approval-to-new-journal criterion
still require the domain owner/product clarification described in docs/slo.md.
