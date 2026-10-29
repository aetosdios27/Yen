# Game day report — 2026-10-29

## What ran

The YEN-61 randomized run used the real Postgres 16 database, `@yen/ledger` transaction and event append functions, the shared `verifyFundState` checker, the Postgres notification outbox and `NotificationsWorker`, and `AnchoringWorker` with a deterministic fake chain. The provider was fake and recorded both send attempts and provider effects by idempotency key. The chain was fake; no live RPC was contacted.

Command:

```sh
YEN_TEST_DATABASE_URL=postgres://postgres:yen@127.0.0.1:37713/yen \
YEN_CHAOS_SEED=1640038382 pnpm --filter @yen/ledger test:chaos:randomized
```

The run completed 1,000 scenarios with seed `1640038382`, 2,500 ledger operations, and 323 injected transaction crash points: 106 before write, 100 after event append, and 117 before commit. Each scenario ran against persisted Postgres state and checked ledger/event agreement, replayed balances, `verifyChain`, spendable funds excluding unverified pledges, notification delivery and effects, idempotent anchor ranges, and independently recomputed anchor roots. The exact runner output was:

```text
REAL CHAOS PASS scenarios=1000 seed=1640038382 operations=2500 injectedCrashes=323 crashPoints=before-write:106,after-event:100,before-commit:117 violations=0 durationMs=354737
Test Files  1 passed (1)
Tests  3 passed (3)
Duration  358.55s
```

The DB-backed verification passed with `YEN_TEST_DATABASE_URL` set: Biome checked 483 files, and Turborepo completed 36 of 36 tasks. The ledger package had 74 passing tests; its two opt-in tests (the 1,000-scenario run and container restart) were run separately. The queue package had 52 passing tests and one optional Anvil test skipped. The API package had 390 passing tests and one optional live ClamAV test skipped. The `useMathMinMax` diagnostics in anchoring are warnings; Biome exited successfully.

The PR #47 database failure tests ran in `pnpm verify`: backend termination during a transaction, rollback after ledger/event work, concurrent reserve contention, and concurrent settlement retries. The Postgres container restart case passed separately with `YEN_CHAOS_CONTAINER` set so it did not restart the database while parallel full verification was using it.

## Worker failure drills

The real notification worker process was sent `SIGKILL` at `claimed`, `sent-to-provider`, and `status-recorded`. A Postgres-backed fake provider counted attempts and stored one effect per idempotency key. Recovery delivered all three outbox rows; provider calls were 1, 2, and 1 respectively, and each key had exactly one effect. The second call at `sent-to-provider` represents retry after provider acceptance; exactly-once effect depends on the provider honoring the stable key.

The anchoring worker was run against a fake chain that failed `getLatestSequence`. It emitted an alert through the injected sink and persisted no incomplete anchor. The application `/health` request still returned 200. After RPC recovery, repeated worker runs drained the backlog into one confirmed anchor with the correct root.

## Finding and fix

The real notification worker initially dead-lettered claimed messages because raw Postgres JSONB `template_data` arrived as a JSON string, while template validation expected an object. `PostgresNotificationStore` now decodes that field at its boundary; a store regression test covers the database representation.

The first chain resilience integration retried `publish` after a fake chain accepted the root but returned an error, so the existing restart recovery test observed a second broadcast. Chain writes now use one client attempt; the next durable worker run reads the on-chain root before deciding whether to publish again. A unit regression test covers the single-attempt option, and the anchoring worker test verifies no duplicate broadcast.

No ledger, replay, hash-chain, spendable-balance, notification-effect, or anchor-root violations remained in the 1,000-scenario run.

## Coverage limits

- Randomized ledger crash points abort real Postgres transactions at selected boundaries; they do not randomly kill the Node process or restart Postgres. The deterministic PR #47 tests separately cover backend termination, and the restart drill separately covers container restart.
- The notification provider and chain are deterministic fakes. The notification kill drill proves the worker/outbox recovery path and fake provider dedupe, not the behavior of a specific production vendor. A real provider must honor the idempotency key for exactly-once external effect.
- The outage drill exercises one chain RPC failure boundary and app health locally. It does not test a live network, RPC vendor, contract deployment, or long-running production alert delivery.
- Partner API and WhatsApp/SMS production clients do not exist in this repository. Their resilience policies and the shared wrapper are documented for future clients; neither policy is exercised against a live service.
- The ClamAV adapter is wired to the shared resilience wrapper, but this game day did not use a live ClamAV daemon.

No migration was required.
