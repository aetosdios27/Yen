# Event log core

This package defines the v1 wire format and computes event hashes without I/O. The SQL append path is pending YEN-18. An event envelope is exactly `{fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash}`. `seq` begins at 1 for each fund. The first `prev_hash` is 64 lowercase zeroes. Later `prev_hash` values equal the preceding event's `hash`.

`hash = SHA-256(UTF-8("yen/eventlog/event/v1\\0") || UTF-8(RFC8785(envelope without hash)))`. The final domain byte is NUL (`0x00`); the full multi-byte prefix differs from the Merkle domains `0x00` through `0x04`. Hashes are 64 lowercase hexadecimal characters. `eventHashToLeafInput` turns one into the shared `Hash32` expected by `leafHash(salt, eventHash)`; `eventLeafHash` calls that shared function.

`canonicalize` sorts object keys by UTF-16 code units, uses ECMAScript number and JSON string serialization, and rejects non-JSON values, lone surrogates, and cycles. Amounts are nonnegative safe integer **paise** JSON numbers; signed balances are safe integer paise. `@yen/shared` has no `paiseWire` rule. No floating-point amount or unsafe integer enters a v1 payload. A future decimal-string amount encoding requires a new event version. `occurred_at` is an injected UTC timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form. Equal timestamps are allowed; decreasing timestamps fail verification.

Every person reference uses the same `PseudonymId`: `psn_<uuid>`, where `<uuid>` is the canonical lowercase, hyphenated value of `pseudonyms.pseudonym_id` (a `uuid` column in `@yen/db`). The database stores the bare UUID; the application adds `psn_` in event `actor` and `member_id`. A raw user UUID is invalid in either field. No donor or requester person reference appears in the v1 payloads. Payloads use IDs, hashes, integers, and short enums. Names, phone numbers, VPAs, free-form notes, and raw evidence are not accepted. Each payload is a strict object, so new fields require a new `version`. **Once v1 is released or persisted, change any payload by defining v2 and keep the v1 parser and golden hashes forever.** The fields below are provisional until their owning fund, donation, expense, bank, and anchoring issues settle; decide them before v1 is used in production.

| Type (version 1)             | Payload fields                                                                                              | Status      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| `fund.created`               | `org_id`, `visibility` (`private`, `members`, `public`)                                                     | Provisional |
| `fund.policy_changed`        | `approval_quorum`, `objection_window_hours`                                                                 | Provisional |
| `fund.visibility_changed`    | `visibility`                                                                                                | Provisional |
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

## Database follow-up contract

After YEN-18, create an event table with `fund_id uuid`, `seq bigint`, `type text`, `version integer`, `actor text`, `occurred_at text`, `payload jsonb`, `prev_hash text`, `hash text`, and `canonical_envelope text`. Use `(fund_id, seq)` as the primary key; validate sequence bounds and lowercase 64-character hash strings. Keep `occurred_at` as the canonical UTC millisecond string so PostgreSQL session time zones cannot alter hash input. `payload` must preserve JSON value semantics and be validated against the selected version's schema. The database must independently verify that `canonical_envelope` is RFC 8785 canonical JSON for precisely the eight envelope fields other than `hash`, and recompute the hash from its UTF-8 bytes. Prove the database canonicalizer against these vectors; PostgreSQL `jsonb::text` is not a substitute.

`appendEvent(fundId, input)` should run in one transaction: take a transaction-scoped advisory lock keyed by fund ID, read the latest event, parse it, call `makeNextEvent`, insert the complete row, and return that row. The insert trigger must independently enforce the fund-local gapless sequence, genesis or preceding hash, canonical UTC time order, known type/version and payload schema, and `hash = SHA-256(domain || canonical envelope)`. Update, delete, and truncate triggers must always reject; revoke those privileges and direct insert from application roles so only the append path can write. The table and append function must share the same pinned golden vectors. Use the same transaction for any outbox record that announces an appended event.

## Prior art

- [Schneier and Kelsey](../../docs/REFERENCES.md#schneier-kelsey) address compromise of a logging machine; Yen does not implement their encryption scheme.
- [Transactionally staged job drains](../../docs/REFERENCES.md#brandur-job-drain) motivate the proposed transactional outbox.
- [PostgreSQL triggers](../../docs/REFERENCES.md#pg-trigger) distinguish statement-level TRUNCATE triggers from row triggers.
- [RFC 8785](../../docs/REFERENCES.md#rfc-8785) defines canonical JSON; Yen adds a versioned hash domain and strict event schemas.
- [Crosby and Wallach](../../docs/REFERENCES.md#crosby-wallach) describe auditing untrusted logs; Yen requires an externally authenticated head to verify a complete chain.
- [DPDP Act](../../docs/REFERENCES.md#dpdp-act) informs minimizing personal data; pseudonyms alone do not establish compliance.
- [PostgreSQL explicit locking](../../docs/REFERENCES.md#pg-locking) describes transaction-scoped advisory locks proposed for the pending append path.
