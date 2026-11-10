# Compromised approver account: lock, credential revocation and recovery

Use this runbook when an approver or owner account is or may be controlled by
someone other than its owner: a SIM swap intercepted the one-time password, a
device with an active session was stolen, a passkey credential is used from an
unknown device, or the account owner reports actions they did not take.

Severity is SEV-1 while the account holds approver or owner role, because the
money path runs through approval consensus. Read
[../account-recovery.md](../account-recovery.md) for the standing recovery
architecture and [break-glass.md](break-glass.md) for the boundaries: revoking
access and freezing an account is always allowed; approving anything on the
account owner's behalf is never allowed.

## Authentication facts, for orientation

- Users authenticate with a phone number via one-time passwords (WhatsApp
  first, SMS fallback). There are no static passwords, so "password reset" does
  not exist; containment means cutting sessions and credentials.
- Approvals of payouts require the account's approval PIN
  (`user_approval_pins`); after 10 failed PIN attempts in 24 hours the PIN
  locks permanently and other approvers are notified.
- Sessions live in the `sessions` table with a `revoked_at` timestamp; trusted
  devices in `trusted_devices`; passkey-style WebAuthn credentials in
  `device_credentials` with `revoked_at`.
- The threat model in [../account-recovery.md](../account-recovery.md) covers
  SIM swap and recycled phone numbers; treat a report of OTP messages the user
  never requested as a possible SIM swap in progress.

## Immediate containment

Run the containment statements below with an administrative database
connection; the application role may intentionally lack the needed privileges.

1. Open a SEV-1 incident thread and record who reported, when, and what actions
   look unauthorized. Notify the club organization owner at once; for a
   compromised approver the attackers' goal is money movement, not persistence.
2. Confirm the account's current role. If it no longer holds an approver or
   owner role, downgrade severity accordingly and follow the generic leak
   runbook [kms-rotation.md](kms-rotation.md) instead.
3. Revoke every session and trusted device of the account. The API exposes
   `revokeAllUserSessions` internally; from the database the equivalent
   containment is:

   ```sh
   psql "$DATABASE_URL" -c "UPDATE sessions SET revoked_at = now() WHERE user_id = '<user-id>' AND revoked_at IS NULL RETURNING id;"
   psql "$DATABASE_URL" -c "DELETE FROM trusted_devices WHERE user_id = '<user-id>' RETURNING session_id;"
   ```

   Record every revoked session id in the thread. Revoked sessions end on the
   request path immediately; there is no grace period to wait for.
4. Revoke passkey credentials:

   ```sh
   psql "$DATABASE_URL" -c "UPDATE device_credentials SET revoked_at = now() WHERE user_id = '<user-id>' AND revoked_at IS NULL RETURNING credential_id;"
   ```

5. Lock the approval PIN. If the attacker has not already tripped the 10-attempt
   lockout, do not brute force it; remove the PIN so approval cannot complete
   until the account is recovered. Record the change and who approved it in the
   thread.

   ```sh
   psql "$DATABASE_URL" -c "DELETE FROM user_approval_pins WHERE user_id = '<user-id>' RETURNING user_id;"
   ```

6. Block re-entry paths while containment holds:
   - The compromised phone number must not be able to receive OTPs that grant
     access. If a SIM swap is suspected, the number itself is hostile until the
     carrier resolves it; do not re-issue OTPs to it.
   - Watch for new sessions appearing after revocation; a new session within
     minutes means the attacker still controls the OTP channel. Keep the
     incident SEV-1 and involve the carrier escalation path.

## Impact assessment before recovery

1. List every approval, payout, expense, and settings change in the suspected
   compromise window. Fund events are pseudonymous: the `actor` column holds a
   `psn_` pseudonym, not a user id, so match the window and event types first
   and resolve the pseudonym mapping afterwards:

   ```sh
   psql "$DATABASE_URL" -c "SELECT fund_id, seq, type, occurred_at, actor, payload FROM fund_events WHERE occurred_at BETWEEN '<window-start-rfc3339>' AND '<window-end-rfc3339>' AND type LIKE 'expense%' ORDER BY fund_id, seq;"
   ```

   `occurred_at` is stored as RFC 3339 text, so string comparison works. Compare
   the listed approvals against the account owner's statement of what they
   actually did, using the pseudonym mapping and the notification records for
   the approval PIN events.
2. Any expense or payout that the owner does not recognize is a potential fund
   loss. Do not reverse or "fix" fund events in place; the event log is
   append-only and editing it is a break-glass violation
   ([break-glass.md](break-glass.md)). Record the events, escalate to the club
   organization owner, and pursue reversal through the ledger's own forward
   operations (objections, reversing expenses) with proper approvals, or accept
   the loss explicitly.
3. Verify fund integrity end to end: `pnpm --filter @yen/db verify-chain` for
   each affected fund, and confirm anchors for the window match the chain
   ([anchor-recovery.md](anchor-recovery.md)). A failed verification turns this
   into the divergence scenario in
   [incident-response.md](incident-response.md).

## Recovery

Recovery follows the support-assisted process in
[../account-recovery.md](../account-recovery.md). In summary, and with the
compromise-specific additions:

1. Verify the account owner's identity out of band (government ID photo match,
   secondary contact). For approvers, recovery requires dual approval by other
   approvers or the organization owner; never perform administrative relinking
   on the request of the affected account alone.
2. If the phone number was SIM swapped, re-bind the account only to a number
   the owner controls after the carrier confirms the port-back, and confirm the
   new subscriber actually receives the OTP during the procedure.
3. Re-enroll credentials fresh: new approval PIN set by the owner, new passkey
   registrations, no trusted devices carried over from before the incident.
4. Keep the account out of the approver rotation until the owner confirms
   control and the organization owner signs off.

## Closure

1. Confirm revoked sessions stay revoked, no new sessions appeared, and fund
   verification passes.
2. Post the club communication using the template in
   [incident-response.md](incident-response.md): what happened, what was
   protected by the approval consensus, what actions were taken, what treasurers
   should watch for.
3. Post-mortem within 5 business days. Cover the entry path (SIM swap, stolen
   device, social engineering), detection latency, and whether containment
   steps were executable by hand quickly enough; slow manual SQL under pressure
   is a finding, not a footnote.
