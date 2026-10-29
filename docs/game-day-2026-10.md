# Game day report — 2026-10-29

## What ran

The randomized run exercised the real Postgres 16 database, `@yen/ledger` writes, event append, event replay, and `verifyChain`; the real Postgres notifications outbox and `NotificationsWorker`; and the real `AnchoringWorker` with a deterministic fake chain. A fake provider recorded provider requests and one effect per idempotency key. The run used a dedicated local Postgres 16 container on `127.0.0.1:39243`; no live chain or provider was contacted.

Command (with `YEN_TEST_DATABASE_URL` exported to the dedicated database URL):

```sh
YEN_RUN_1000_CHAOS=1 YEN_CHAOS_SEED=1640038382 \
  pnpm --filter @yen/ledger exec vitest run src/chaos.randomized.test.ts
```

The seeded run performed 1,000 scenarios, 2,500 ledger operations, and 323 injected transaction crash points: 106 before write, 100 after event append, and 117 before commit. After every scenario, the harness checked atomic ledger/event writes, replayed balances, `verifyChain`, spendable funds excluding unverified donations, notification delivery and provider effects, idempotent anchor ranges, and recomputed anchor roots. The final run after the alert-sink regression fix reported:

```text
REAL CHAOS PASS scenarios=1000 seed=1640038382 operations=2500 injectedCrashes=323 crashPoints=before-write:106,after-event:100,before-commit:117 violations=0 durationMs=293499
Test Files  1 passed (1)
Tests  3 passed (3)
Duration  297.11s
```

The three tests include the real notification worker kill-point drill and the chain outage/recovery drill. The kill points were `claimed`, `sent-to-provider`, and `status-recorded`. All three outbox rows reached `delivered`; fake-provider calls were 1, 2, and 1 respectively, with exactly one recorded effect per key. The second call after the `sent-to-provider` kill is expected: exactly-once effect relies on the provider honoring the stable idempotency key.

For the chain outage, the fake RPC failed `getLatestSequence`. The worker emitted `anchor.rpc_unavailable` through the shared alert sink and left no incomplete anchor, while `/health` returned 200. After recovery, repeated worker runs produced one confirmed anchor with the recomputed root. Main’s reconciliation hook shares the same `ResilientCall` and `AnchorAlertSink`; it also routes `getBalance` and `getRoot` through the chain policy.

## Merge integration and verification

The final run was repeated after merging main through PR #61. Main’s `nightly-invariants.yml` arrived unchanged. The PR #58 anchoring structure remains the base: published roots are recovered with `recoverPublishedAnchor`, pending transactions can be fee-replaced, confirmations record `confirmed_at`, the CLI selects `KmsRootSigner` when `ANCHOR_KMS_KEY_ID` is configured, and reconciliation reports stale anchors, root mismatches, and low publisher balances. YEN-61 wraps all `RootChain` methods used by anchoring and reconciliation. Chain reads use three attempts; `publish` and `replacePending` use one attempt to avoid rebroadcasting an accepted transaction. The CLI shares one chain client, resilience instance, and alert sink between the worker and reconciliation hook.

`pnpm install --frozen-lockfile` passed. After rebuilding stale `@yen/eventlog` and `@yen/ledger` workspace outputs from the merged source, `TURBO_CONCURRENCY=3 pnpm verify` passed with `YEN_TEST_DATABASE_URL` set to the dedicated Postgres 16 container: Biome checked 513 files and Turborepo completed 36/36 tasks. The ledger tests reported 74 passed and 2 skipped, queue reported 58 passed and 1 skipped, notifications reported 46 passed, database reported 324 passed, and API reported 407 passed and 1 skipped. Biome had no errors; its remaining `useMathMinMax` findings in the anchoring files and two unrelated warnings did not fail the command.

The queue anchoring test file passed separately with 12 tests passed and the optional Anvil integration skipped. The real Postgres container restart drill passed separately (1 test). `node --test .github/scripts/*.test.mjs` passed 32/32, including the nightly-invariants workflow guards, and `node .github/scripts/check-trust-claims.mjs` reported that the register is well formed.

Neither `anvil` nor `forge` was installed in the environment, so the real Anvil integration could not run. The merge retained main’s migrations through `0018`; YEN-61 added no migration.

## Findings and fixes

- The real notification worker initially dead-lettered claimed messages because Postgres returned JSONB `template_data` as a JSON string while template validation expected an object. `PostgresNotificationStore` now decodes it at the database boundary; a regression test covers this representation.
- A timed-out chain `publish` was retried after the fake chain accepted the root, causing a duplicate broadcast. `publish` and `replacePending` now receive one client attempt; the next worker run checks the published root before sending again.
- Main’s structured alert sink threw while serializing a `bigint` sequence, masking the simulated post-broadcast crash and breaking restart recovery. The sink now serializes bigint values as decimal strings, with a regression test.

The final 1,000-scenario run had zero invariant violations. No ledger/event atomicity, replay, hash-chain, spendable-balance, notification-effect, or anchoring-root violations remained.

## Coverage limits

- The randomized crash points abort real Postgres transactions at selected boundaries; they do not randomly kill the Node process or restart Postgres. Worker SIGKILL points, PR #47 backend-termination tests, and the container restart drill ran separately.
- The provider and chain are deterministic fakes. The notification test proves the outbox/worker recovery path and fake-provider deduplication; an actual provider must honor the idempotency key for exactly-once external effects.
- The outage test covers RPC failure, alert emission, local application health, and recovery against a fake client. It does not exercise a live network, vendor, or production alert delivery.
- Partner API and production WhatsApp/SMS clients do not exist in this repository. Their policies and the shared wrapper are documented for future clients. ClamAV uses the wrapper, but this game day did not use a live daemon.
- Anvil was unavailable, so no local EVM deployment or real contract publication was exercised.
