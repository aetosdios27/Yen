# @yen/policy

A pure, zero-I/O, deterministic authorization and field-level redaction engine for Yen. It is not wired into the API yet; the API uses its separate development policy.

## Overview

Authorization is the primary source of real-world leaks and privilege escalation in financial platforms. `@yen/policy` centralizes object-level authorization, separation of duties, and data minimization in one pure, thoroughly tested library with:
- **Zero I/O, zero clock, zero randomness inside the engine**: all decisions are pure functions of actor, action, resource, and explicit policy state.
- **Deny-by-default architecture**: any unmapped role or action evaluates to `false`.
- **Branded type safety**: uses canonical IDs (`FundId`, `PseudonymId`, `UserId`, `Paise`) from `@yen/shared`.
- **Field-level redaction**: transforms records into branded `Redacted<T>` views before they can cross API boundaries.

## Verified Role x Action Matrix

The matrix below is verified by compile-time exhaustiveness types (`RoleActionMatrix`) and table-driven tests (`packages/policy/src/matrix.test.ts`) covering all 154 role $\times$ action pairs (22 actions $\times$ 7 roles):

| Action                      |  owner  | treasurer | approver | auditor | donor | member | public |
| :-------------------------- | :-----: | :-------: | :------: | :-----: | :---: | :----: | :----: |
| `fund:create`               |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `fund:read`                 |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW | ALLOW  | ALLOW* |
| `fund:update_policy`        |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `fund:update_visibility`    |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `fund:close`                |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `fund:add_member`           |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `fund:remove_member`        |  ALLOW  |   DENY    |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:submit`            |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:approve`           | ALLOW** |   DENY    | ALLOW**  |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:reject`            |  ALLOW  |   DENY    |  ALLOW   |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:flag`              |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW |  DENY  |  DENY  |
| `expense:raise_objection`   |  DENY   |   DENY    |   DENY   |  ALLOW  | ALLOW |  DENY  |  DENY  |
| `expense:resolve_objection` |  ALLOW  |   DENY    |   DENY   |  ALLOW  | DENY  |  DENY  |  DENY  |
| `expense:payout`            |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:add_evidence`      |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `expense:read`              |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW | ALLOW  | ALLOW* |
| `donation:pledge`           |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW |  DENY  | ALLOW  |
| `donation:verify`           |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `donation:reject`           |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |
| `donation:read`             |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW | ALLOW  | ALLOW* |
| `audit:read_log`            |  ALLOW  |   ALLOW   |  ALLOW   |  ALLOW  | ALLOW | ALLOW  | ALLOW* |
| `bank:reconcile`            |  ALLOW  |   ALLOW   |   DENY   |  DENY   | DENY  |  DENY  |  DENY  |

\* Read actions evaluate fund visibility tiers (`public`, `donors`, `members`, `private`). Public access is denied unless visibility is explicitly `public`.
\*\* Approval actions enforce separation of duties.

## Separation of Duties

The engine strictly enforces two core dual-control rules on expense approvals:
1. **Requester cannot approve own request**: Even if an actor holds the `owner` or `approver` role, their approval is rejected if `actor.id === expense.requesterId`.
2. **Treasurer cannot be sole approver**: A treasurer's approval alone can never satisfy the quorum. Even if an actor holds dual roles (`treasurer` + `approver`), or if the fund's quorum is 1, a treasurer approval alone is denied. Every approved expense requires at least one independent, non-treasurer approver.

Primary reference:
- [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) (Dual control & separation of duties).

## Spend Thresholds and Tiered Quorums

Fund policies support configurable spend threshold rules (`SpendThresholdRule`):
- Expenses below thresholds use base quorum $M$.
- Expenses meeting or exceeding thresholds require higher approval quorums ($M_{threshold}$).

```typescript
export interface SpendThresholdRule {
  readonly minAmountPaise: Paise;
  readonly requiredQuorum: number;
}
```

## Visibility Tiers and Field-Level Redaction

Calls to `redact(viewer, record)` return a branded `Redacted<T>` view:
- **Public Masking**:
  - **Names**: Converted to uppercase initials separated by periods (e.g., `"Jane Doe"` $\rightarrow$ `"J. D."`, `"Aarav Sharma"` $\rightarrow$ `"A. S."`).
  - **Donors**: Completely pseudonymous. Real names, phone numbers, email addresses, and bank transaction IDs are stripped. Only `donorPseudonymId` (`psn_<uuid>`) is retained.
  - **Evidence/Bills**: Hash-only. File URLs, filenames, and MIME types are stripped; only cryptographic SHA-256 content hashes (`contentSha256`) are exposed.
  - **Notes**: Internal administrative notes are removed for unauthenticated/public viewers.
- **Donors and members**: Receive masked names, pseudonymous donations, and hash-only evidence. Notes are omitted.
- **Staff**: Internal administrative roles (`owner`, `treasurer`, `approver`, `auditor`) receive allowlisted operational fields. Unknown fields are dropped for every viewer; unsupported shapes throw `RedactionError`. Expense and donation amounts use `Paise`.

Primary references:
- [OWASP API Security Top 10 (2023) - API1 Broken Object Level Authorization & API3 Broken Object Property Level Authorization](https://api-security.owasp.org/editions/2023/en/0x11-t10/)
- [UK ICO Pseudonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/)
- [Digital Personal Data Protection Act 2023 (Section 6 - Data Minimisation)](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf)

## Eventlog v1 Schema Gap Report

Policy mutations are recorded as events. In terms of `packages/eventlog` v1 provisional event schemas:
- `fund.policy_changed`: Supports `approval_quorum` and `objection_window_hours`.
  - _Missing in v1_: `spend_thresholds` (schema has no field for tiered threshold rules).
- `fund.visibility_changed`: Supports `"private" | "members" | "public"`.
  - _Missing in v1_: `"donors"` tier (`visibility` enum omits `"donors"`).
- `member.added`: Supports `"member" | "approver" | "treasurer"`.
  - _Missing in v1_: `"owner"` and `"auditor"` roles (`role` enum omits `"owner"` and `"auditor"`).

The API route redaction test is a static tripwire, not a proof that all data paths are safe.
