# PostgreSQL backup and restore drill

This drill uses a disposable PostgreSQL 16 container and a custom-format logical dump. It verifies one populated fund after restore with the ledger and event-chain checks used by the chaos suite. The 10x pilot-traffic load test for the public fund page and API is tracked separately in YEN-54.

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

The separately invoked load runner accepts `--ops`, `--seed`, and `--batch`; it streams the final event-chain check and reports progress with the seed needed to reproduce a run. Its 80/20 seeded operation mix is donations with randomized integer-paise amounts and expense holds. It is intentionally excluded from `pnpm verify`. Nightly CI runs 100,000 operations; `workflow_dispatch` also offers one million.

On 2026-10-29, one local 100,000-operation run completed with seed `49049`, 80,081 donations, 19,919 holds, and zero invariant violations in 2,070.99 seconds (48.29 ops/sec). It ran against PostgreSQL 16.15 in Podman on the x86_64 host described above (22 logical CPUs, about 30.8 GiB RAM), while other test and database containers were active and host load varied. A straight-line projection at this measured rate puts one million operations at about 5 hours 45 minutes; that projection is unverified and host-specific. The scheduled 100,000-operation count leaves room below the nightly job's 90-minute limit; use manual dispatch for the full million-operation run.

## Recovery objectives and limits

No production backup schedule or recovery service is deployed by this repository. Therefore Yen does not currently claim a production RPO or RTO. If a production operator takes and verifies one `pg_dump` snapshot every night, the schedule alone implies a worst-case data-loss window of nearly 24 hours, plus any missed or delayed backup interval; alerting on backup freshness and protected off-host retention are also required before claiming that RPO. This custom logical archive is a consistent single-database dump and can be selectively restored with `pg_restore`; it is not a physical base backup and cannot be used for WAL replay. See the PostgreSQL 16 [`pg_dump` documentation](https://www.postgresql.org/docs/16/app-pgdump.html).

PostgreSQL 16 PITR uses a base backup plus a continuous sequence of archived WAL segments and recovery configuration. With a monitored, working archive pipeline, recoverability can approach the most recent successfully archived WAL, so the RPO depends on archive lag and any missing segments. PITR is **not implemented here**: there is no base-backup schedule, `archive_mode`/`archive_command` or archive library, protected WAL store, recovery configuration, archive-lag alert, or PITR rehearsal. PostgreSQL explicitly notes that `pg_dump` archives are logical and insufficient for WAL replay; see its [continuous archiving and PITR documentation](https://www.postgresql.org/docs/16/continuous-archiving.html). Database roles, extensions, configuration, encryption keys, and backup credentials also need separate protected recovery procedures.

### Rehearsal result (2026-10-29)

The restore drill was run successfully three times against PostgreSQL 16.15 in disposable Podman containers on the rebased PR tree. Each fixture contained one fund, one committed donation (one journal, two ledger entries), and its two fund events. The custom archives were 121,751, 121,756, and 121,757 bytes. The measured `pg_restore` phase took **716 ms, 861 ms, and 903 ms** (median 861 ms; range 716–903 ms); every restored fixture then passed `verifyFundState` with `events=2` and `bankPaise=12345`. This measures the restore command for this tiny fixture, not provisioning, production cutover, or end-to-end service recovery, so it is not a production RTO commitment.

The host was x86_64 Linux with Podman 5.8.9, 22 logical CPUs and about 30.8 GiB RAM; the PostgreSQL 16.15 container had no explicit CPU or memory limit. Host load averages after the three runs were 4.50, 4.79, and 7.08. The run is repeatable for this fixture, but its small compressed archive, loopback/local storage, available host CPU, and lack of production-sized data limit the result. A separate attempt on the initial checkout was interrupted by a terminated database connection during migration and is excluded from the three successful timing samples. Larger fixtures and full service recovery must be rehearsed before setting a production RTO.

## Container restart exercise

The short chaos suite injects a terminated backend and an application transaction abort at the ledger/event boundary. For a full server interruption, run the explicit restart case against an isolated Postgres 16 container:

```sh
YEN_TEST_DATABASE_URL=postgres://... \
YEN_CHAOS_CONTAINER=<disposable-container-name> \
pnpm --filter @yen/ledger chaos:restart
```

The restart drill first writes a batch of committed transactions, restarts the database during the test run, reconnects with a fresh client, then verifies every complete posting and event survived. It does not claim to deterministically interrupt a specific `COMMIT` window; backend termination and transaction-abort tests cover aborted in-flight transactions. A connection interrupted during `COMMIT` has an ambiguous client outcome: reconnect and verify before retrying, and do not automatically retry non-idempotent writes.
