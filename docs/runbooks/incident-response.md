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
