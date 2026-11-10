# Incident response

This document defines the incident management protocol for pilot Yen deployments
and the step-by-step recovery procedures for three of the six incident scenarios
tracked in YEN-50: API outage and crash loops, database failover and
point-in-time recovery, and Merkle root verification failure with chain
divergence. The other scenarios live in
[anchor-recovery.md](anchor-recovery.md), [kms-rotation.md](kms-rotation.md),
[account-compromise.md](account-compromise.md), and the non-negotiable
boundaries every responder must read before acting are in
[break-glass.md](break-glass.md).

Severity targets here are proposals for the pilot phase, the same way the
objectives in [../slo.md](../slo.md) are proposals. Nothing in this repository
ships a paging service; the rotation below assumes a small pilot team coordinating
in a private operations channel.

## Severity definitions

| Severity | Definition                                            | Examples                                                                                                                                                                      | Acknowledge       | Update cadence | Post-mortem            |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------- | ---------------------- |
| SEV-1    | Money path blocked or fund data integrity compromised | Donations cannot be recorded; payout approvals stuck; database unavailable; event chain or anchor verification fails; confirmed secret compromise; unauthorized fund movement | 15 minutes        | Every hour     | Within 5 business days |
| SEV-2    | Degraded service without blocking the money path      | Public fund page errors; anchoring lag beyond the 60-minute objective; notification delivery failing; one approver unavailable while quorum still holds                       | 1 business hour   | Every 4 hours  | Optional, recommended  |
| SEV-3    | Minor defect with a workaround and no data risk       | Cosmetic page issue; slow but successful admin action; noisy but correct alert                                                                                                | Next business day | Daily          | No                     |

Classification rules:

- When in doubt between two severities, pick the higher one and downgrade
  explicitly with a note in the incident thread. Downgrading a SEV-1 needs the
  secondary on-call to agree.
- Any suspicion of tampering with the event log, the anchors, or the salts is
  SEV-1 regardless of whether verification currently passes.
- A suspected secret or credential leak is SEV-1 until revocation completes,
  even if the leaked material later proves unused.

## Pilot on-call rotation

- The rotation has two named engineers per week: a primary and a secondary.
- The shift runs Monday 10:00 local time to the next Monday 10:00, handover
  happens in the operations channel with a written note listing open incidents,
  fired alerts, and known risks.
- The pilot coordinator maintains the current and next four primary/secondary
  pairs as the pinned topic of the operations channel. This repository does not
  store the roster.
- Primary owns acknowledgment, severity triage, running the runbooks, incident
  communication, and the resolution note.
- Secondary covers the primary within 15 minutes when paged, shadows every
  SEV-1, and must agree before a SEV-1 is downgraded.
- Swaps are allowed any time before the shift; both engineers confirm the swap
  in the operations channel. During a SEV-1, the on-call does not hand over
  until the incident is downgraded or resolved, or the pilot lead explicitly
  accepts the handover.

## Notification escalation tree

Detection sources: the status probe (`scripts/check-status.ts`), the SLO
observations described in [../slo.md](../slo.md), and club member reports.

1. Alert fires or a report arrives. Anyone may open the incident thread and
   start the timeline; the responder does not need to be on call to open one.
2. Primary acknowledges. SEV-1 within 15 minutes, SEV-2 within 1 business hour.
3. If the primary does not acknowledge a SEV-1 within 15 minutes, the paging
   member escalates to the secondary. After another 15 minutes, escalate to the
   pilot lead. After 30 minutes total, escalate to the club organization owner.
4. Security-related SEV-1s (secret leak, tampering suspicion, account
   compromise) additionally notify the security owner immediately, in parallel,
   never sequentially.
5. If fund data integrity is in doubt, the responder pauses writes as described
   in [break-glass.md](break-glass.md) and the club is notified within one hour
   of the pause, using the template below.

## Club incident communication template

Post updates in the club's operator channel and, for SEV-1, to the club
organization owner directly. State only what is verified. Never speculate about
causes, blame a person, or promise a fix time that is not committed.

```text
Subject: [SEV-n] Yen incident - <short description> - <date>

Status: investigating | identified | monitoring | resolved
Started: <UTC timestamp when the impact began>
Affected: <which features are affected, e.g. donation recording, public fund page>
Unaffected: <explicitly list what keeps working, e.g. fund balances are correct and anchored>

What we know: <verified facts only>
What we are doing: <current action and who is on it>
Next update: <UTC timestamp, within the severity update cadence>

For treasurers: <one line of practical guidance, e.g. "hold new payout approvals until the next update">
```

For incidents that paused writes or touched fund data integrity, the resolved
update must state what verification was run
(`verify-chain` per fund, anchor root comparison) and its result, or say that
verification is still running.

## Blameless post-mortem template

Write the post-mortem for every SEV-1 within 5 business days of resolution and
store it with the other pilot post-mortems (see [../game-day-2026-10.md](../game-day-2026-10.md)
for an existing example). Blameless means the analysis assumes everyone involved
acted reasonably given the information, tools, and incentives they had at the
time; it names systems, gaps, and decisions, never people to fault.

```markdown
# Post-mortem: <title>

- Date: <YYYY-MM-DD>
- Severity: SEV-n
- Author: <name> (facilitator, not owner of the fix)
- Duration: <detect -> resolve, in UTC>
- Incident thread: <link>

## Summary

Three to five sentences: what happened, who or what was affected, how it was
resolved.

## Impact

- User-facing impact: <donations delayed, page down for n minutes, ...>
- Data impact: <none | events replayed, exact verification commands and results>
- Money impact: <none | amounts held, not lost>

## Timeline

All times UTC. Facts only; link to logs or payloads instead of paraphrasing.

- <t0> - change or trigger
- <t1> - first alert or report
- <t2> - acknowledgment and severity assignment
- ... - key actions and findings
- <tn> - resolution and verification

## Root cause

Explain the causal chain, not the trigger alone. Use the five-whys style: keep
asking why until the answer is a process, design, or monitoring gap rather than
a person or a one-off mistake.

## What went well

## What went poorly

## Where we got lucky

## Action items

Every item needs an owner and a tracking issue. Prefer items that remove the
need for heroics over items that add manual steps.

| Action | Type (prevent/detect/mitigate) | Owner | Issue |
| ------ | ------------------------------ | ----- | ----- |
```
## Scenario: API down or unhandled crash loop

Symptoms: `scripts/check-status.ts` reports `api_liveness` or `api_readiness`
failing, the public fund page shows stale or error content, container restarts
repeat, or club members report the app not loading.

Roll back or restart first, diagnose afterwards. Do not debug a live SEV-1 in
production before restoring service.

1. Confirm the scope from outside the service network:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://<api-host>/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://<api-host>/ready
   pnpm exec tsx scripts/check-status.ts
   ```

   `/health` is liveness and answers from process state only; `/ready` runs the
   dependency checks with a 2 second deadline. If `/health` answers but `/ready`
   fails, treat it as a database or dependency incident, not an API crash: jump
   to the database scenario below before restarting anything.

2. If the API process is down or restarting, look at the last crash before the
   first restart so the cause is not lost:

   ```sh
   docker compose ps
   docker compose logs --tail 200 api
   ```

   Capture the panic or unhandled rejection stack trace into the incident
   thread. A crash loop that follows a deploy is treated as a bad deploy.

3. Restore service, in order of preference:
   - Bad deploy: roll back the API to the last known good release. Follow
     [web-rollback.md](web-rollback.md) for the web tier; for the API, redeploy
     the previous release tag or image digest that passed
     [release verification](../verify-release.md).
   - Environment or dependency failure (for example database credentials
     rotated underneath the process): fix the specific dependency; restarting
     alone does not help.
   - Unknown crash with a healthy database: restart the service once.

   ```sh
   docker compose up -d --force-recreate api
   ```

4. If the process crashes again within 10 minutes, treat it as a crash loop:
   keep the incident SEV-1, run the process with the previous working image,
   and file the stack trace as the primary artifact. Do not add retries,
   restart loops, or watchdog scripts around a crash loop; they hide the signal.

5. After recovery, verify from the outside and record in the thread:

   ```sh
   pnpm exec tsx scripts/check-status.ts
   ```

   The probe must report `api_liveness` and `api_readiness` as `ok`. The
   readiness endpoint result is cached for up to 1 second
   (`READINESS_CACHE_MS`), so probe twice a few seconds apart before declaring
   recovery.

6. Downgrade to SEV-2 only when both endpoints answer `ok` for 30 consecutive
   minutes and the club update has been posted. Post-mortem within 5 business
   days for any SEV-1, including restart-only recoveries.
## Scenario: database failover and point-in-time recovery (PITR)

Symptoms: `/ready` fails while `/health` answers, the database check in
`scripts/check-status.ts` fails, connection errors in API and worker logs, or
the managed database provider reports a failed primary.

Yen uses PostgreSQL 16. Read [backup-restore.md](backup-restore.md) first: it
documents what this repository actually provides (a logical `pg_dump` restore
drill) and what it does not (no WAL archiving, no PITR pipeline, no claimed RPO
or RTO). If your deployment runs on a managed provider, PITR comes from the
provider's base backup plus WAL retention; use its restore tooling, then apply
the verification steps below.

### Failover to a standby

1. Stop writers before promoting, so no transaction lands on the dead primary
   after the failover point:

   ```sh
   docker compose stop api worker
   ```

2. Promote the standby. With the managed provider console this is a single
   action; the provider changes the replica role to primary. Record the exact
   promotion timestamp; it becomes the boundary for any later reconciliation.
3. Point the deployment at the new primary and restart the API and worker:

   ```sh
   # update DATABASE_URL, then
   docker compose up -d api worker
   pnpm exec tsx scripts/check-status.ts
   ```

4. Run the fund verification for every active fund and record the results:

   ```sh
   pnpm --filter @yen/db verify-chain <fund-id>
   ```

   Compare the printed head hash and event count against the last
   independently authenticated checkpoint (the most recent confirmed anchor or
   a protected manifest captured per backup-restore.md). A mismatch is a chain
   divergence: switch to the Merkle divergence scenario below.

### Restore from a PITR snapshot

1. Freeze writes and stop the queue worker. Never restore into a database that
   is still accepting writes.
2. In the provider console, start a restore to a new instance at the target
   timestamp. Choose a timestamp at or before the first observed bad write; when
   unsure, pick a few minutes earlier. Keep the damaged instance stopped, not
   deleted: it is evidence for the post-mortem.
3. Restore into a staging instance first, never straight into production.
4. Verify the restored instance before cutover:
   - Per fund, run `pnpm --filter @yen/db verify-chain <fund-id>` on the
     staging instance and compare heads with the protected manifest.
   - For anchors, recompute the salted Merkle roots from restored events and
     salts and compare them with the stored roots, exactly as the
     backup-restore drill does. Missing salts or recomputed root mismatches fail
     the restore.
5. Cut over by pointing `DATABASE_URL` at the verified instance and restarting
   the API and worker, then run `scripts/check-status.ts` and the per-fund
   `verify-chain` once more against production.
6. If the recovery window dropped recent committed donations, reconcile against
   external evidence: payment provider records and bank transactions. Re-record
   only what external evidence proves, and note every replayed event in the
   post-mortem. Do not guess missing events into existence; the hash chain makes
   invented backfills detectable, and inventing them is a break-glass violation.
