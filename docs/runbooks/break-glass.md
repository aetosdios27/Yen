# Break glass: non-negotiable boundaries for incident response

This document is the written commitment of what engineers responding to an
incident will never do, no matter how severe the incident is or how much
pressure there is to restore service quickly. It exists because the worst
plausible recovery action for a verifiable treasury is one that silently
destroys the verifiability itself.

Read this document before executing any other runbook in this directory. Every
runbook here is written to stay inside these boundaries; if you believe an
incident requires crossing one, stop, escalate to the club organization owner,
and treat the conflict as the incident.

## The boundaries

These hold in production, in staging, in a recovered database, and on a
responder laptop. There is no approval level, incident severity, or time
pressure that waives them.

### Never edit or delete immutable event logs

1. Never `UPDATE` or `DELETE` rows in `fund_events`. The table is append-only,
   hash-chained, and protected by database triggers; the correct response to a
   bad event is a forward correcting event or a verified restore from backup,
   never an edit.
2. Never rewrite, truncate, or reorder the hash chain. Recomputing hashes to
   make a modified history validate is indistinguishable from the tampering the
   chain exists to detect.
3. Never delete or overwrite `anchor_event_salts`, and never regenerate salts
   for events that already have them: recomputed Merkle roots would change and
   every previously published on-chain root would stop verifying.
4. Never reset an anchor's `root`, `from_seq`, `to_seq`, or `chain_sequence` to
   force republication. Resetting a failed anchor row's `status` metadata so the
   worker retries is allowed; changing what the anchor commits is not.
5. Never invent events to fill a recovery gap. If a PITR restore or failover
   dropped committed donations, re-record only what external evidence (payment
   provider records, bank statements) proves, and document every replayed event
   in the post-mortem. Missing history stays visibly missing.

### Never bypass multi-approver consensus

6. Never approve, sign, or execute an expense, payout, or settings change on
   behalf of another approver, and never create or use an approval path that
   skips the second approver. An incident never justifies a single-person money
   movement.
7. Never reuse, copy, or act on another person's approval PIN, passkey, or
   session. Credential sharing to unblock a stuck payout is a break-glass
   violation even when both people consent.
8. Never grant an approver or owner role, or re-bind a phone number, without the
   identity verification and dual-approval process defined in
   [../account-recovery.md](../account-recovery.md).
9. Never disable, weaken, or code around the approval PIN lockout, the OTP
   attempt limits, or the objection window to speed up an incident response.

### Never weaken verification to make it pass

10. Never modify verification code, verifier vectors, or expected checkpoints
    during an incident so that a failing check reports success. A verification
    failure is information; silencing it destroys the only independent record.
11. Never disable the database-enforced chain constraints or triggers
    (`fund_events` append-only enforcement, canonical envelope checks) to make a
    repair easier.
12. Never export KMS key material to sign anything by hand. Signing stays inside
    KMS or an explicitly authorized operator key, per
    [kms-rotation.md](kms-rotation.md).
13. Never publish an anchor root that was not recomputed from the fund's stored
    events and salts by the worker's own code path.

### Never hide an incident

14. Never delay declaring an incident to avoid a club communication, and never
    state in a club update something that is not yet verified.
15. Never delete incident evidence: logs, dumps, screenshots, and the incident
    thread itself stay until the post-mortem closes.

## If a boundary conflicts with recovery

1. Stop the destructive action immediately. If it already happened, preserve
   everything (database state, logs, commands run) and say so in the incident
   thread; a disclosed mistake is recoverable, a hidden one is not.
2. Escalate to the club organization owner with a written statement of the
   proposed action, what it would destroy, and the alternative.
3. Treat the conflict itself as the incident: the runbooks in this directory are
   supposed to offer a compliant path. A missing one is a post-mortem action
   item.

## Why these boundaries survive emergencies

- The hash chain and the on-chain anchors are the reason the club can trust its
  own records after an outage. Editing history to restore service faster trades
  the system's entire purpose for a few minutes of uptime.
- Multi-approver consensus is the control that keeps a single compromised or
  panicked account from moving funds. Every historical incident where it was
  bypassed "just this once" became the story of how the funds were lost.
- A verification failure that is made to pass stops being detectable later. An
  outage with intact verification is recoverable; "recovered" data nobody can
  verify is not.
