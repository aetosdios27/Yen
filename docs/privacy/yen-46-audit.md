# YEN-46 audit of main after #124, #123, #62, #63 and #64

Baseline: `a23b499`. Existing controls were retained; this table records the audit,
not a claim of legal compliance.

| Criterion | Main audit | Evidence and gap closure |
| --- | --- | --- |
| Purpose, notice version, timestamp | Met for accounts; gap for new guest subscriptions | `privacy-store.ts` grant/withdraw and `privacy.test.ts`; new migration 0033 and Postgres subscription assertion cover new subscription records |
| Separate WhatsApp consent | Met for accounts; gap for subscription endpoint | `subscription.test.ts` rejects missing update or WhatsApp consent; receipt form has separate unchecked choices |
| Data map, DB-only PII, pseudonymous events | Map outdated; wizard localStorage and payout replay cache gaps | Updated inventory covers all five PRs; `onboarding-privacy.test.tsx` checks browser storage; `payout.test.ts` checks provider sees reference but replay result contains none |
| Erasure/correction and mapping deletion | Existing mapping/expense/invite erasure met; new subscriptions and email guests gap | `privacy-postgres.test.ts`, “erases subscription contacts and receipt names across every persisted table”; verified guest helper and request-process runbook cover accountless contacts |
| Retention and automated deletion | Schedule/CLI met; worker automation and subscription expiry gap | `retention.test.ts` purges unsubscribed contacts; queue `retention.test.ts` checks persisted daily schedule and actual job deletion |
| Grievance contact and request process | Contact linked; operational process undocumented | Product `/privacy` names contact; `request-process.md` records verification, correction, erasure, exceptions and escalation |
| PII scanner in CI | Earlier events/Merkle scanner met; public API and real audit export coverage gap | Expanded Postgres scanner inspects events, leaf, anchors, actual public timeline/audit API and bundle, before and after erasure; CI Verify runs API tests with required Postgres |
| Erase all seeded identifiers, keep verifyChain valid | Older feature fixture met; later features undercovered | Expanded test seeds invites, payee bank/UPI details, receipt names and email/phone subscriptions, scans every public-schema table for unique seeded values and checks stored-chain verification and unchanged export |
| Notice linked in product | Met | `app-footer.test.tsx`, “links the terms and privacy pages from the shared footer”; `/privacy/page.tsx` |
| Lawyer/mentor notice review | Not achievable in code | Outstanding: fund operator must arrange and record review. No approval is inferred from this audit |

Guest email is deliberately not inferred from an account phone or name. Operators
must verify the guest contact before using the deletion command. Club financial
records and explicitly logged legal-retention exceptions remain governed by the
existing inventory; already downloaded receipts and provider/backup copies need
operational handling described in the request process.
