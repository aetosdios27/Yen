# @yen/eventlog

This package defines the v1 wire format and computes event hashes without I/O. The database persistence layer is implemented in `@yen/db` via migration `0003_fund_events.sql` and `appendEvent`. An event envelope is exactly `{fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash}`. `seq` begins at 1 for each fund. The first `prev_hash` is 64 lowercase zeroes. Later `prev_hash` values equal the preceding event's `hash`.

Hash input is the canonical JSON encoding of the unsigned event envelope under [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS), hashed with SHA-256 and domain-separated by the UTF-8 bytes of `yen/eventlog/event/v1\0`.

## Event types and v1 payloads

| Event type                   | Required payload properties                                                                                 | Status      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| `fund.created`               | `org_id`, `visibility` (`private`, `members`, `public`)                                                     | Provisional |
| `fund.policy_changed`        | `approval_quorum`, `objection_window_hours`                                                                 | Provisional |
| `fund.visibility_changed`    | `visibility` (`private`, `members`, `public`)                                                               | Provisional |
| `member.added`               | `member_id`, `role` (`member`, `approver`, `treasurer`)                                                     | Provisional |
| `member.removed`             | `member_id`                                                                                                 | Provisional |
| `donation.pledged`           | `donation_id`, `amount_paise`                                                                               | Provisional |
| `donation.verified`          | `donation_id`, `bank_transaction_id`                                                                        | Provisional |
| `donation.rejected`          | `donation_id`, `reason` (`unmatched`, `duplicate`, `cancelled`)                                             | Provisional |
| `expense.submitted`          | `expense_id`, `amount_paise`                                                                                | Provisional |
| `expense.evidence_added`     | `expense_id`, `evidence_id`, `content_sha256`                                                               | Provisional |
| `expense.flagged`            | `expense_id`, `reason` (`missing_evidence`, `policy`, `suspicious`)                                         | Provisional |
| `expense.objection_raised`   | `expense_id`, `objection_id`                                                                                | Provisional |
| `expense.objection_resolved` | `expense_id`, `objection_id`, `resolution` (`upheld`, `dismissed`)                                          | Provisional |
| `expense.approved`           | `expense_id`                                                                                                | Provisional |
| `expense.rejected`           | `expense_id`, `reason` (`quorum`, `objection`, `policy`)                                                    | Provisional |
| `expense.expired`            | `expense_id`                                                                                                | Provisional |
| `expense.paid`               | `expense_id`, `bank_transaction_id`                                                                         | Provisional |
| `expense.reversed`           | `expense_id`, `bank_transaction_id`                                                                         | Provisional |
| `bank.credit_seen`           | `bank_transaction_id`, `amount_paise`                                                                       | Provisional |
| `bank.debit_seen`            | `bank_transaction_id`, `amount_paise`                                                                       | Provisional |
| `bank.balance_checked`       | `balance_paise`                                                                                             | Provisional |
| `discrepancy.raised`         | `discrepancy_id`, `bank_transaction_id`, `kind` (`unmatched_credit`, `unmatched_debit`, `balance_mismatch`) | Provisional |
| `discrepancy.resolved`       | `discrepancy_id`, `resolution` (`matched`, `corrected`, `dismissed`)                                        | Provisional |
| `anchor.published`           | `anchor_id`, `global_root`                                                                                  | Provisional |

`parseEvent(unknown)` returns a `Result<Event>` and rejects unknown type/version pairs and raw properties that canonical JSON would omit. `parseEvent(...).ok === true` checks **format only**. It says nothing about whether the stored hash is correct or whether the event belongs to an intact chain. `makeNextEvent(previous, input)` checks the preceding event, assigns `seq` and `prev_hash`, and computes `hash`. `computeEventHash(unsignedEvent)` accepts exactly the eight fields without `hash`; extra or missing fields throw before hashing.

`verifyChain(events, expected)` and `verifyChainStream(events, expected)` require a fund-bound `ChainHead`. `chainHead({ fundId, count, latestHash })` requires a canonical `FundId` from `@yen/shared`; it validates the fund ID, nonnegative safe integer count, and 32-byte lowercase hexadecimal hash. Count zero requires `genesisHash`. The brand exists only in TypeScript and provides no runtime proof of authenticity. Both verifiers reject events from another fund and return the first break with its `index`, `seq`, and reason. `index` is the zero-based position in the supplied sequence; `seq` is one-based. Thus the first extra event is at `index: expected.count`, including `index: 0` when the expected count is zero. Both verifiers close the source iterator on an early break. `ok: true` means the complete chain matches that head and includes `verifiedAgainst: ChainHead`.

`checkChainStructure(events)` and `checkChainStructureStream(events)` return `status: "structure-consistent"` and an unbranded `observedHead` containing the observed fund ID, count, and latest hash. The fund ID is `null` for an empty sequence. A mixed-fund sequence returns `status: "broken"` with the first break. Structure checks read to the end and do not exclude truncation. They have no `ok: true` result, so they cannot authorize a verified badge. Hash verification establishes integrity, not whether a claim is true or an actor was authorized.

## Showing a verified badge

`chainHead(observedHead)` does not typecheck without a cast. Even with a cast, a head observed from the same untrusted event source defeats the check. Obtain the head for the displayed fund from an externally authenticated checkpoint, such as an on-chain anchored global root plus a Merkle proof of that fund's leaf. Trigger-maintained database state alone is not an independent public checkpoint. The API may use that state to serve and prepare receipts, but the verify page must authenticate the checkpoint independently.

An authentic checkpoint can still be stale and verify only an obsolete prefix. A successful integrity result carries `verifiedAgainst`, the exact head used. The UI must show “verified up to event N as of <checkpoint time>”, using the authenticated checkpoint time, rather than an unqualified verified badge.

The independent, standard-library-only Python generator writes `test-vectors/canonical-vectors.json` and `test-vectors/golden-events.json`:

```sh
python3 packages/eventlog/test-vectors/generate_canonical_vectors.py
```

Changelog: YEN-21 tightened chain verification, unsigned hashing, pseudonym IDs, and array canonicalization; both golden fixture files and their pinned hashes were regenerated by the independent Python reference, including astral Unicode acceptance and lone-surrogate rejection.

## Person references and pseudonyms

Every reference to an individual in event envelopes (`actor`) and payloads (e.g. `member_id`) uses a pseudonym formatted as `psn_<canonical-lowercase-uuid>`.

Pseudonyms are strictly **per person per fund** (YEN-70). Previously, a single pseudonym followed a user across all funds, which allowed external observers of public records to correlate an individual's donations, approvals, or objections across different funds. Under the per-fund model, each `(user, fund)` pair receives an independent, distinct pseudonym stored in `fund_pseudonyms` in `@yen/db`. The legacy single-user `pseudonyms` table is deprecated and unused.

The canonical event wire format (`psn_<uuid>`) and cryptographic event hashing remain unchanged.

## Database persistence contract

The database persistence layer is implemented in `@yen/db` via migration `0003_fund_events.sql` with the `fund_events` table: `fund_id uuid`, `seq bigint`, `type text`, `version integer`, `actor text`, `occurred_at text`, `payload jsonb`, `prev_hash text`, `hash text`, and `canonical_envelope text`. Primary key is `(fund_id, seq)`; sequence bounds and lowercase 64-character hash strings are constrained with CHECK constraints. `occurred_at` is preserved as the canonical UTC millisecond string so PostgreSQL session time zones cannot alter hash input.

The database independently verifies that `canonical_envelope` is RFC 8785 canonical JSON for precisely the eight envelope fields other than `hash`, and recomputes SHA-256 over `'yen/eventlog/event/v1' || E'\\x00' || utf8(canonical_envelope)` using PostgreSQL's built-in `sha256(bytea)` function. The database canonicalizer does not rely on `jsonb::text`; it implements RFC 8785 rules including UTF-16 code unit key sorting and ECMAScript number formatting in PL/pgSQL, proven against `canonical-vectors.json` and `golden-events.json`.

`appendEvent(client, input)` in `@yen/db` is the single authorized write path: it runs inside a transaction, takes a transaction-scoped advisory lock keyed on the fund ID (`pg_advisory_xact_lock`), reads the latest event, calls `makeNextEvent`, inserts the complete row, and returns the stored event. The insert trigger independently enforces the fund-local gapless sequence, genesis or preceding hash, real UTC millisecond timestamps in order, known type/version and exact payload schema, and hash equality. Its head lookup targets the public table even when a temporary table has the same name. Update, delete, and truncate triggers always raise, and those privileges are revoked from PUBLIC; application roles must not be granted them directly.
