# PostgreSQL backup and restore drill

This drill uses a disposable PostgreSQL 16 container and a custom-format logical dump. It verifies every fund after restore with the ledger and event-chain checks used by the chaos suite, and recomputes salted anchor roots against a manifest captured before the dump. The 10x pilot-traffic load test for the public fund page and API is tracked separately in YEN-54.

## Prerequisites

Install Podman, Node 24 and pnpm 12. The PostgreSQL client tools run inside the disposable PostgreSQL image. Ensure the selected local TCP port is unused; the script chooses an ephemeral port and removes its container and temporary archive on exit.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @yen/ledger backup:restore
```

The drill creates isolated source and restore databases and seeds four funds: three with 25 donations each, a settled expense, a pending hold, and a salted Merkle anchor commitment, plus one empty fund. It captures every fund's event count and head hash and every anchor's interval and root in a manifest outside the database archive. It dumps the source using `pg_dump --format=custom`, restores with `pg_restore --exit-on-error`, and verifies every restored fund with `verifyFundState`. Missing/extra funds, changed chain heads, changed roots, missing salts, or recomputed root mismatches fail the drill. These fixture anchors are local commitments, not transactions published to a live chain.

For an existing isolated restored database, retain a manifest produced by `captureRestoreManifest` from the source at the backup snapshot and run:

```sh
cd packages/ledger
YEN_TEST_DATABASE_URL=postgres://... YEN_RESTORE_MANIFEST=/protected/source-manifest.json node scripts/verify-restored.mjs
```

The snapshot and manifest must describe the same state; quiesce writers while capturing them. Keep the manifest independently protected. This fixture drill captures it after seeding with no writers running. For production, separately compare commitments with the authenticated chain/checkpoint source; copying a manifest from an untrusted restored database provides no independent assurance.

## What this establishes

The custom archive contains a logical database snapshot and can be selectively restored. The verifier checks journal balance, pending-hold totals, exact replayed balances, and the hash chain against the pre-dump manifest, and recomputes each stored anchor root from restored events and salts. This does not prove authenticity against an attacker who can alter both the database and its observed head; use an independently authenticated checkpoint for that.

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


### Expanded rehearsal and nightly audit (2026-11-10)

The expanded fixture restored successfully on PostgreSQL 16.15 in Podman: four funds, three anchor intervals, 75 donations, three settled expenses and three pending holds. The archive was 245,277 bytes and the `pg_restore` command took 1,525 ms. All four funds passed chain/replay/ledger verification and all three recomputed roots matched the independent source manifest. This is production-shaped synthetic data, not production-volume data or a complete service recovery. Production RPO/RTO remain operator commitments requiring backup scheduling, retention, freshness monitoring, provisioning and a timed cutover rehearsal.

The latest observed scheduled [nightly run](https://github.com/aetosdios27/Yen/actions/runs/42597336657) on main (`a23b499`) printed:

```text
result ops=100000 seed=3942630993 donations=80097 holds=19903 duration=1984.91s ops_per_sec=50.38 violations=0
```

The scheduled job selects 100,000 operations with a 90-minute limit; manual dispatch offers 1,000,000 with a 360-minute limit. **A million-operation pass has not been established.** Progress shows increasing cost: 45,000–50,000 took 93.1 seconds, while 95,000–100,000 took 161.1 seconds. The runner serializes one fund on a single connection; holds and balance checks operate on a growing ledger. Neither the aggregate rate nor a straight-line extrapolation establishes a million-operation completion time. The measured count remains 100,000; do not close the million-operation criterion from a green scheduled job.

The failure alert is proven by [failed run 40868945093](https://github.com/aetosdios27/Yen/actions/runs/40868945093): its alert job succeeded and printed [issue #99](https://github.com/aetosdios27/Yen/issues/99). That issue's body contains the exact failed-run URL. The alert's `Seed` currently prints the raw run ID; to reproduce the invariant run reduce it modulo 4,294,967,296 as the runner step does.

| YEN-49 scope                                            | Audit result                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Randomized operations, zero-sum and recomputed balances | `scripts/invariants-load.mjs` covers seeded donations and holds with per-batch journal checks and final balances. It is serial, does not cover all application request/approval/reconciliation paths, and does not replay events. Broader concurrent fault coverage is in `src/chaos.randomized.test.ts`, under the separate chaos owner. |
| Public page/API at 10× pilot traffic                    | `packages/load-tests` and `.github/workflows/load-test.yml` exist, but the default server returns synthetic fund HTML/JSON. Ten connections are not a documented 10× pilot request rate. Actual deployment load validation remains YEN-54 work.                                                                                           |
| API/worker death, no partial state                      | `src/chaos.test.ts` covers backend termination and transaction aborts; `src/chaos.randomized.test.ts` covers process/worker faults. The chaos workflow and randomized suite are owned separately and unchanged here.                                                                                                                      |
| Restore every fund and compare roots                    | Expanded drill plus `src/restore.test.ts`: positive verification, missing/extra fund checkpoint rejection, missing salt rejection, and incorrect recomputed root rejection.                                                                                                                                                               |
| Nightly main and alert                                  | Scheduled green run and failed alert run linked above.                                                                                                                                                                                                                                                                                    |
| 1M with zero violations                                 | Open; only the observed 100,000-operation run is established.                                                                                                                                                                                                                                                                             |
