# YEN-82 follow-up evidence

Base: fetched `origin/main` at `9534a88`, containing merged PR #157 (`b04cedc`).

## Audit and completion

| Item                 | Audit on main                                                                                  | Result and observable test                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: public query cost | Gap: indexed bank ID cast to text; outstanding sum scans all pledges; neither query registered | Shared production/EXPLAIN statements in `packages/db/src/public-fund-queries.ts`; native UUID bank/pledge/expense links, confirmed-anchor range scans on `fund_events_pkey`; partial covering pledge index. `query-plan.test.ts`: “verifies every registered hot-path query satisfies its expected plan shape and cost budget” and “rejects the old public text-join plan and a missing outstanding-pledge index”.                                                                          |
| 2: fund badge        | Gap: API never anchored; bank-matched rendered verified                                        | Shared schema/type and explicit nonempty coverage rule. `public-fund.test.ts`: “reports fund verification as %s from coverage of every matched item”; `fund-header.test.tsx`: six English/Hindi states; `data.test.ts`: three states. Unreconciled paid expenses prevent the anchoring checkmark.                                                                                                                                                                                           |
| 3a: totals           | Gap: store-only tests; no HTTP/ledger proof                                                    | `public-fund-http-postgres.test.ts`: “proves HTTP totals against ledger balances before and after statement reconciliation, isolated by fund”; “excludes a rejected donation after the product refund operation and keeps HTTP totals equal to the ledger”.                                                                                                                                                                                                                                 |
| 3b: states           | Gap: manually inserted read-store fixtures only                                                | HTTP test “proves donation and expense states through approval, debit matching and worker confirmation; public bytes redact private data”. Real Postgres stores, pledge posting, statement ingestion, approval/hold/payment/reconciliation, anchoring worker, and the extracted queue-test fake chain. Pending and submitted are not anchored; worker confirmation after 12 blocks is required. Reconciled expenses stay unverified until anchoring, consistent with existing item wording. |
| 3c: false anchoring  | Some guards met in SQL, missing HTTP proof                                                     | HTTP tests “does not borrow another fund's anchor or an earlier interval for a newly matched donation”; “refuses a confirmed anchor without a transaction hash, and a cross-fund pledge link”; lifecycle test checks debit amount mismatch and status-only expense with no own debit. Invalid states are injected only after legitimate operations establish the fixture: product operations cannot produce those contradictions.                                                           |
| 3d: public redaction | Gap: in-memory route proof only                                                                | Lifecycle HTTP test reads summary, timeline and breakdown as an anonymous public principal. It checks response text for seeded phone, UTR, VPA, account, donor full name and evidence storage key.                                                                                                                                                                                                                                                                                          |

## Product defect found by the HTTP proof

`recordRefund` reversed ledger balances and emitted `donation.rejected` but left
`donation_pledges.status = 'verified'`. The public donation read therefore kept
counting refunded money. The operation now sets the pledge status to `rejected`
in the same transaction. This changes the write that caused the discrepancy;
it adds no cache or denormalized total.

Red excerpt (new HTTP test against the old refund operation):

```text
FAIL excludes a rejected donation after the product refund operation and keeps HTTP totals equal to the ledger
- "raisedPaise": "0"
+ "raisedPaise": "5000"
Tests 1 failed | 3 passed (4)
```

Fund-state red excerpt (new route test against main's summary logic):

```text
FAIL reports fund verification as anchored from coverage of every matched item
- "verification": "anchored"
+ "verification": "bank-matched"
Tests 1 failed | 10 passed (11)
```

Green focused runs:

```text
public-fund-http-postgres.test.ts: Tests 5 passed (5)
public-fund.test.ts + public-fund-store-postgres.test.ts: Tests 15 passed (15)
fund-header.test.tsx + data.test.ts: Tests 10 passed (10)
query-plan.test.ts + migrate.test.ts: Tests 119 passed (119)
```

Full `pnpm verify` with Postgres on port 55582 passed all 39 tasks, including API
548 passed (one pre-existing skip), web 307 passed, DB 368 passed, ledger 83
passed (two pre-existing skips), and queue 72 passed (one pre-existing skip).

The final full verification also runs the added query-plan mutation test, which
executes the old text-join statement and requires its cost guard to reject it,
and drops the new pledge index to require a missing-index failure.

## Plans and timings

Fixture: one busy fund with 50,000 events, 20,000 matched credits, 25,000 pledges
(20,000 verified and 5,000 outstanding), five confirmed anchors. Both anchor
queries return 20,000 IDs; both totals return 500,000 paise. This is a deliberately
heavy single-fund fixture, not a claim about typical page sizes.

Initial two-run reproduction was done before changing the production statement:
second run 130.788 ms for anchoring and 3.264 ms for outstanding pledges. The later
retained files are five alternating before/after runs on the final SQL and same
fixture, with the partial pledge index dropped for each before side and recreated
for each after side. Every run checks result counts and the pledge total.

| Statement              | Before median (range), ms | After median (range), ms  |
| ---------------------- | ------------------------- | ------------------------- |
| Anchored items         | 169.855 (164.483–236.090) | 177.079 (161.517–197.051) |
| Outstanding pledge sum | 2.309 (2.204–2.470)       | 0.889 (0.674–0.951)       |

**No measurable anchor latency improvement in this worst-case fixture.** The
shared machine had load averages around 24 on 22 logical CPUs; independent
workloads remained active. The ranges overlap. The anchor plan shape improves:
root estimated cost 214,229.51 → 2,235.78; the old JSON-bank-ID merge sort and temp
spill disappear. Estimated cost is not a wall-clock speedup.

The after anchor number is limited by 20,000 bank primary-key lookups and 20,000
pledge primary-key lookups, followed by deduplication. Run 2 records 122,762 shared
buffer hits and no temp spill; the nested-loop portion takes 164.3 ms of 189.8 ms
execution. The sum uses an index-only scan of the 5,000 outstanding rows; run 2
has zero heap fetches. Freshly written pages can require heap visibility checks
until vacuum. These are database statement timings, not end-to-end page latency.

The registered budgets are 2,500 for anchored items and 260 for the sum, with
required event and partial pledge indexes and sequential scans forbidden on the
respective target tables. Existing budgets are unchanged. The plan dataset is
vacuumed/analyzed to exercise index-only scans; the HTTP tests use normal writes.

Full `EXPLAIN (ANALYZE, BUFFERS)` output is in `before-*-1.txt` through
`before-*-5.txt` and `after-*-1.txt` through `after-*-5.txt`. Run counts, machine
load, data shape and timings are in [samples.json](samples.json).

Reproduce on an empty throwaway database from the repository root:

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:55582/yen \
  pnpm exec tsx packages/db/scripts/yen82-plans.ts --seed
```

`--seed` uses a synthetic, clearly separated planner fixture, including disabled
chain-insert validation inside its fixture transaction. It must only run in the
throwaway benchmark database. Product behavior tests never use this fixture.

## Migration and delivery

Migration `0034_public_pledge_totals.sql` is independent of the other owner's PR.
Per the user's corrected instruction, its number may be renumbered to `0035`
during a directed rebase if the other migration merges first. No event index,
cache, or denormalized total was added. Changes to ledger refund status, policy's
shared type export, and the queue fake-chain test helper are required by this
issue's proof and remain limited to those behaviors.

The operator owns merging. A human must inspect the Vercel preview on a phone
before approving, as required by CONTRIBUTING.md; no browser inspection is
claimed by these tests.
