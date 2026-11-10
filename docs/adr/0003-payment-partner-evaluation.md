# ADR 0003: Payment Partner Evaluation, Sandbox Ingestion, and RBI PA Exclusion

Status: Accepted for YEN-7
Date: 2026-11-10
Issue: [YEN-7](https://github.com/aetosdios27/Yen/issues/78)

## Context and Problem Statement

Yen is a verifiable transparency layer for club money. It never holds, pools, or settles club funds: donations land in the club's own bank account and approved expenses are paid out of that same account. To reconcile recorded pledges and expenses against real money movement, and to execute approved payouts, Yen needs a regulated payment partner that supplies three capabilities:

1. **Statement ingestion**: webhook or export-based statements covering credits (donations) and debits (payouts, bank charges) for the club's account, feeding the reconciliation pipeline (`apps/api/src/reconciliation`).
2. **VPA verification**: resolution of the registered name behind a UPI VPA before payouts are initiated and to corroborate donation counterparty data.
3. **Payout initiation**: an API that debits the club's own bank account, compatible with Yen's maker-checker approval chain (`PayoutOrchestrator` and `PartnerPayoutAdapter` in `@yen/ledger`), with idempotency keys protecting against duplicate debits.

The partner operates against the club's bank account, not against a Yen-held balance. Yen's role stays that of a technology service provider (see the regulatory analysis below). This ADR evaluates partner options on sandbox access, webhook coverage, verification latency, payout compatibility, fees, and KYC feasibility for registered university clubs, and records the chosen primary, the runner-up, and the refusal path if both partners reject a non-profit club's onboarding.

## Requirements

- **Sandbox access with mock capabilities**: reproducible test credits, debits, and payout status transitions so CI can exercise the adapter boundary without live money.
- **Statement and webhook support for credits and debits**: signed webhook payloads (HMAC), both directions of money movement, delivery of posted timestamps and UTRs suitable for exact UTR matching in the reconciliation engine.
- **VPA name verification API with usable latency**: a verification round trip that fits inside an interactive payout approval flow (seconds, not minutes).
- **Payout initiation API**: idempotency, explicit terminal status webhooks, and role-based approval (maker-checker) that Yen can mirror from its own `PayoutOrchestrator` approval gates.
- **Fee structure and KYC onboarding for registered university clubs**: predictable per-payout pricing and onboarding documents a university club can actually produce (registration certificate, committee resolution, authorised signatory KYC).
- **Documented refusal path**: what Yen does when a partner declines a student-run club, without weakening the transparency guarantees.

## Comparative Analysis of Payment Partner Options

| Dimension                           | RazorpayX (Chosen Primary)                                                                                                                                      | Cashfree Payouts (Runner-up)                                                                                         | Setu                                                                                        | Bank-direct (Club's Own Bank)                                                                                          |
| :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| **Sandbox access and mock support** | Test-mode keys with mock virtual accounts, mock payouts and deterministic status transitions                                                                    | Sandbox console with test tokens, mock payout accounts and simulated status callbacks                                | Console-issued sandbox credentials focused on collections and account aggregation flows     | None for most corporate APIs; statement verification via exported CSV fixtures only                                    |
| **Statement/webhook support**       | Signed webhooks for `virtual_account.credited` and payout lifecycle events (`payout.processed`, `payout.settled`, `payout.rejected`); covers credits and debits | Signed webhooks for payout status; statement webhooks for virtual account credits via Cashfree's collection products | Collection webhooks (payment links, UPI); no debit-side statement stream for a club account | No webhooks; periodic CSV export (already ingested by the reconciliation CSV parser) or bank-specific portal downloads |
| **VPA name verification**           | Fund account validation API resolves the registered name behind a VPA; typical latency 1 to 3 seconds                                                           | VPA validation API with registered name response; comparable latency                                                 | Not a standalone product in the current catalog; verification embedded in collection flows  | Not available through the bank; would require an external verification provider anyway                                 |
| **Payout initiation API**           | REST payouts with idempotency keys, quoting for NEFT, IMPS, RTGS and UPI payouts; debits the connected club account                                             | REST payouts with idempotency and batch support; UPI payouts included                                                | Payouts not the platform focus; better suited to collections and verification utilities     | Bank proprietary API or portal; heavy per-bank integration, no uniform contract                                        |
| **Maker-checker compatibility**     | Dashboard-level multi-approval roles; Yen's `PayoutOrchestrator` enforces its own maker-checker before the API call                                             | Role-based approval workflows in the dashboard; equivalent fit                                                       | Not applicable to payout flows                                                              | Native bank-portal dual authorization (maker, checker, authoriser), strongest enforcement but manual                   |
| **Fee structure**                   | Per-payout fees by rail plus a platform subscription tier; virtual account credits bundled                                                                      | Per-payout fees, historically no monthly platform fee                                                                | Per-API-call pricing on collection and verification products                                | Standard bank charges (NEFT/RTGS), no platform fee                                                                     |
| **KYC for university clubs**        | Requires a registered legal entity (society, trust, Section 8 company, or registered business) with signatory KYC                                               | Same class of requirement: registered entity plus authorized signatory documents                                     | Entity onboarding similar to other PSPs                                                     | The club's existing bank relationship and signatories already satisfy onboarding                                       |

## Decision Summary

1. **Primary**: RazorpayX, integrated strictly as a technology customer of the club's account relationship (details below).
2. **Runner-up**: Cashfree Payouts, drop-in substitute on the same adapter boundary.
3. **Refusal path**: bank-direct operation, using statement CSV ingestion plus manual bank-portal payouts, if partners reject the club's onboarding.

## Chosen Primary: RazorpayX

RazorpayX is the primary because it is the only option that covers all three required capabilities against the club's own bank account with a sandbox that reproduces every state the reconciliation and payout pipelines must consume:

- Signed webhooks for both directions of money movement (`virtual_account.credited` for donation credits, `payout.processed`/`payout.rejected` for payout debits), carrying UTRs and posted timestamps that the reconciliation engine matches exactly.
- Fund account validation resolves the registered name behind a VPA in 1 to 3 seconds, which fits inside an interactive maker-checker approval flow.
- Idempotent payout initiation with explicit terminal status callbacks, which the `PartnerPayoutAdapter` boundary in `@yen/ledger` maps onto the `PayoutOrchestrator` approval gates.

The integration shape is the same as for any option in the table above: the partner is the regulated money mover, Yen is a technology service provider that reads signed webhooks, calls verification and payout APIs, and writes what it learned into the ledger. No club money ever transits a Yen-held balance (see the regulatory analysis below).

## Runner-Up: Cashfree Payouts

Cashfree Payouts is the runner-up. Its payout API and webhook model map onto the same adapter boundary with a credential and configuration swap, and its fee structure (per-payout pricing without a monthly platform tier) suits low-volume clubs. It is retained as the documented substitution target if RazorpayX onboarding fails, pricing changes materially, or webhook reliability degrades. The adapter boundary in `packages/ledger/src/partner/types.ts` is deliberately partner-agnostic: schemas carry normalized credit/debit events, signature envelopes, statement entries, and VPA verification results, not RazorpayX payload shapes.

## Refusal Path and Backup Fallback Strategy

Partner onboarding for registered university clubs can still fail. The most common reasons are a club that is an informal student body without a registered legal entity (society, trust, or Section 8 company), an account younger than the partner's minimum history window, or missing authorized signatory KYC. The fallback strategy is layered so that the first two steps keep the adapter boundary unchanged and only the last step degrades automation:

1. **Onboard under an existing registered entity.** Many universities operate an alumni foundation, an incubation society, or a sponsored-project cell that is already KYC-complete with the partner. The club's bank account (or a sub-account the foundation controls) becomes the partner-connected account, and the club remains the operator. Yen's adapter boundary, schemas, and reconciliation pipeline are unchanged; only the credentials and the club's onboarding paperwork change.
2. **Switch to the runner-up.** If RazorpayX refuses the club (directly or through the sponsoring entity), Cashfree Payouts is tried next under the same integration shape. This is a configuration and credential change, not a code change.
3. **Bank-direct operation (refusal path).** If both partners reject the club's onboarding, Yen operates without a payment partner:
   - Statement ingestion continues through the CSV export path already implemented in `apps/api/src/reconciliation/csv-parser.ts`; bank statement downloads replace webhook pushes on a scheduled polling cadence.
   - Credit and debit detection, UTR matching, and alert detection run unchanged against the parsed statements; the transparency guarantees (hash-chained event log, gapless sequence numbers, deterministic matching) are unaffected.
   - VPA verification degrades to pre-registration: the beneficiary VPA and expected name are captured at payout request creation, verified by the club treasurer against the bank's own beneficiary verification, and the recorded verification evidence is stored as part of the payout approval trail.
   - Payout initiation reverts to the bank portal's native dual authorization (maker, checker, authoriser). Yen records the approved payout request before execution and the bank's debit statement entry after execution; reconciliation closes the loop.
   - Yen still never holds, pools, or settles club funds. Only the level of automation degrades, never the audit properties.
