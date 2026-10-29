# PostgreSQL backup and restore drill

This drill uses a disposable PostgreSQL 16 container and a custom-format logical dump. It verifies one populated fund after restore with the ledger and event-chain checks used by the chaos suite.

## Prerequisites

Install Podman, Node 24 and pnpm 12. The PostgreSQL client tools run inside the disposable PostgreSQL image. Ensure the selected local TCP port is unused; the script chooses an ephemeral port and removes its container and temporary archive on exit.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @yen/ledger backup:restore
```

The drill creates isolated source and restore databases, migrates and seeds a fund with a committed donation, dumps the source using `pg_dump --format=custom`, restores it with `pg_restore --exit-on-error`, then runs `verifyFundState` on the restored fund. Success prints the restored fund ID, event count and bank balance. Any mismatch exits nonzero. The script only operates on its own disposable container.

## What this establishes

The custom archive contains a logical database snapshot and can be selectively restored. The verifier checks journal balance, pending-hold totals, exact replayed balances, and the hash chain against the restored chain tail. This does not prove authenticity against an attacker who can alter both the database and its observed head; use an independently authenticated checkpoint for that.

`pg_dump` is not a physical base backup and cannot be used for continuous-archiving WAL replay. Production point-in-time recovery requires a base backup plus a continuous, tested archive of WAL segments, recovery configuration, monitoring, and periodic restore exercises. Retain and protect database roles, extensions, configuration, encryption keys, and backup credentials separately. See [PostgreSQL 16 pg_dump](../REFERENCES.md#pg-dump) and [continuous archiving/PITR](../REFERENCES.md#pg-pitr).

## Container restart exercise

The short chaos suite injects a terminated backend and an application transaction abort at the ledger/event boundary. For a full server interruption, run the explicit restart case against an isolated Postgres 16 container:

```sh
YEN_TEST_DATABASE_URL=postgres://... \
YEN_CHAOS_CONTAINER=<disposable-container-name> \
pnpm --filter @yen/ledger chaos:restart
```

The restart drill first writes a batch of committed transactions, restarts the database during the test run, reconnects with a fresh client, then verifies every complete posting and event survived. It does not claim to deterministically interrupt a specific `COMMIT` window; backend termination and transaction-abort tests cover aborted in-flight transactions. A connection interrupted during `COMMIT` has an ambiguous client outcome: reconnect and verify before retrying, and do not automatically retry non-idempotent writes.
