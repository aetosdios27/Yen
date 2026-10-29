# Account Recovery: Phone Number Change (MVP)

This document describes the account recovery architecture and operational procedure for Yen users who have changed or lost their phone number.

---

## 1. Context & Threat Model

In Yen, users authenticate using their phone number via WhatsApp-first and SMS one-time passwords (OTP). There are no static passwords.

Because Yen manages community funds and transparent financial records, account access must be strictly guarded against:
- **SIM-swap fraud**: An attacker fraudulently ports or reissues a victim's SIM card to intercept OTPs.
- **Recycled phone numbers**: Telecom operators in India reassign inactive prepaid mobile numbers after 90 days. A new subscriber receiving a recycled number must not gain access to a previous user's private records or administrative privileges.
- **Social engineering**: Attackers impersonating legitimate treasurers or approvers to hijack fund controls.

For the MVP, Yen implements a **support-assisted account recovery process** backed by out-of-band verification and dual-approval requirements for fund managers.

---

## 2. Recovery Workflow (Support-Assisted MVP)

```
[User with New Phone] ──► [Support Request]
                                │
                                ▼
                   [Identity Verification]
                   • Government ID / Photo Match
                   • Secondary Email Check
                   • Dual-Approval (for Approvers)
                                │
                                ▼
                     [Administrative Re-link]
                     • Update phone to new E.164
                     • Revoke ALL active sessions
                     • Emit audit log event
                                │
                                ▼
               [User Logs In via OTP on New Phone]
               • Retains UUID, roles, transaction history
```

### Step 1: Request Initiation

The user initiates an account recovery request via Yen's support channel (`support@yen.org` or authorized in-app support chat):
- Provides their previous phone number and new E.164 phone number.
- Provides their community name / fund name they participate in.

### Step 2: Identity & Authorization Verification

Before any phone number modification in the database:
1. **Regular Members / Donors**:
   - Verification via secondary registered email address or proof of recent bank contribution to the fund.
2. **Fund Approvers & Treasurers (Elevated Roles)**:
   - **Dual Authorization Requirement**: At least one other verified administrator or trustee of the same community fund must independently confirm the phone number change via video call or signed internal communication.
   - Verification of government ID matching the KYC name on record.

### Step 3: Administrative Database Re-link Procedure

An authorized support operator executes the phone re-link using the administrative tooling or controlled database procedure:

1. **Verify Uniqueness**: Check that the new phone number is not already associated with another active user account.
2. **Update User Record**: Update the `users` record to point to the new normalized E.164 phone number. The user UUID remains unchanged, ensuring all past donations, expenses, and ledger entries remain intact.
3. **Global Session Revocation**: Invalidate all existing sessions for the user across all devices:

   ```sql
   UPDATE sessions
   SET revoked_at = NOW()
   WHERE user_id = $1 AND revoked_at IS NULL;
   ```
4. **Audit Trail**: Write an administrative audit entry recording:
   - Operator ID
   - Support ticket reference
   - Timestamp
   - User UUID and pseudonymized phone hashes (no plain phone numbers in audit logs).

### Step 4: Verification Login

- The user navigates to the login screen and enters their new phone number.
- The user completes OTP verification sent via WhatsApp/SMS to the new phone number.
- Upon successful verification, a new session is issued with their existing identity and permissions.

---

## 3. Recycled Phone Number Protection

When a telecom reassigns a dormant phone number to a new subscriber:
- If an account has been completely inactive for > 180 days with no active sessions or transactions, a first-time login with a recycled number triggers a safety check.
- If the new subscriber cannot verify past fund details, a fresh user profile is created, disassociating the recycled phone from the stale account.

---

## 4. Post-MVP Automation Roadmap

1. **Self-Service Phone Change (Dual-Device OTP)**:
   - When the user still possesses the old phone: User requests change in-app -> enters OTP on old number -> enters OTP on new number -> 24-hour security cooldown before full approver privileges transfer.
2. **Passkey / WebAuthn Fallback**:
   - Hardware security keys or biometric device credentials (Touch ID / Face ID) bound as a secondary recovery factor.
3. **In-App Community Vouching (M-of-N Approval)**:
   - Self-service recovery requests prompt push notifications to 2 of 3 designated community trustees to approve the new phone directly in their app.
