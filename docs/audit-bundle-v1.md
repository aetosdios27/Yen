# Audit bundle v1

This is the normative wire and verification specification for `yen/audit-bundle/v1`. It preserves the immutable nine-field `@yen/eventlog` envelope and the existing two-level salted Merkle construction from `@yen/shared`; it defines no new event, hash, or tree domain. SHA-256 and canonical JSON follow [FIPS 180-4](REFERENCES.md#fips-180-4) and [RFC 8785](REFERENCES.md#rfc-8785). Tree splitting follows [RFC 6962 §2.1](REFERENCES.md#rfc-6962).

## JSON shape

The top-level object has exactly these required values:

```json
{
  "format": "yen/audit-bundle/v1",
  "fund_id": "canonical-lowercase-uuid",
  "chain": { "start_seq": 0, "start_hash": "64 lowercase hex digits" },
  "events": [],
  "roots": [],
  "anchor": {
    "chain_id": 80002,
    "contract_address": "0x followed by 40 hex digits",
    "sequence": 1,
    "tx_hash": "0x followed by 64 hex digits",
    "root": "64 lowercase hex digits"
  }
}
```

`chain` identifies the authenticated predecessor immediately before this bundle segment. For genesis use sequence `0` and 64 zeroes. The bundle must contain at least one event. Event sequence values begin at `start_seq + 1` and increase by one.

Each item in `events` has:

```json
{
  "event": {
    "fund_id": "uuid",
    "seq": 1,
    "type": "fund.created",
    "version": 1,
    "actor": "psn_uuid",
    "occurred_at": "2026-01-01T00:00:01.000Z",
    "payload": {},
    "prev_hash": "64 lowercase hex digits",
    "hash": "64 lowercase hex digits"
  },
  "salt": "64 lowercase hex digits",
  "latest_event_hash": "64 lowercase hex digits",
  "eventProof": { "index": 0, "size": 1, "path": [] },
  "fundProof": { "index": 0, "size": 1, "path": [] }
}
```

The event envelope has exactly the listed nine fields. Its `hash` covers the other eight. Each proof has a zero-based `index`, positive `size`, and a list of 32-byte lowercase hexadecimal siblings. `salt` is exactly 32 bytes. Event ranges in `roots` are inclusive and each root has `start_seq`, `end_seq`, `event_root`, positive `fund_count`, and `global_root`. A supplied range commits to every event sequence in that range. A range's end event hash must equal that entry's `latest_event_hash`.

## Hash and proof formulas

All hash outputs below are 32 bytes. `JCS(x)` is RFC 8785 canonical JSON encoded as UTF-8. The event hash is:

```text
event_hash = SHA256(UTF8("yen/eventlog/event/v1\0") || JCS(event without hash))
```

The event leaf is `SHA256(0x00 || salt[32] || event_hash[32])`. Internal nodes use `SHA256(0x01 || left[32] || right[32])`. For each proof, start with its leaf and fold the path from leaf to root. If the current index is odd, or is the last node in an odd-sized level, hash `sibling || current`; otherwise hash `current || sibling`. After each level, divide the index and size by two using integer division. The path is valid only if it ends with size one. The tree split is the largest power of two strictly smaller than the number of leaves; an unpaired final node is not duplicated.

The fund fingerprint and leaf are:

```text
fingerprint = SHA256(0x03 || fund_id[16 UUID bytes] || latest_event_hash[32])
fund_leaf = SHA256(0x02 || u64be(eventProof.size) || event_root[32] || fingerprint[32])
```

`fundProof` proves this fund leaf in the interval's fund tree. Its wrapped global root is:

```text
global_root = SHA256(0x04 || u64be(fundProof.size) || fund_tree_root[32])
```

`u64be` is an unsigned 8-byte big-endian integer. All counts and indexes must be safe nonnegative integers; proof sizes and fund counts must be positive. The bundle's event proof size must equal its matched root range length, its event proof index plus that range's start must equal the event sequence, and its fund proof size must equal `fund_count`.

## Verification order and verdicts

Implementations check these stages in order and report the first failure:

1. **Bundle format:** required values, UUID and hash encodings, and a nonempty event array. Failure code: `FORMAT_INVALID`.
2. **Event hashes:** exact envelope keys and recomputed event hash for every event. Failure code: `EVENT_HASH_INVALID`.
3. **Chain segment:** event fund IDs, sequences, predecessor hashes, UTC millisecond timestamps, and nondecreasing timestamp order match the supplied checkpoint. Failure code: `CHAIN_INVALID`.
4. **Inclusion proofs:** each event path and fund path reproduce the corresponding range's event and global roots, including size, index, count, and final event hash bindings. Failure code: `PROOF_INVALID`.
5. **Batch ranges:** ranges are ordered, nonoverlapping, gap-free, and cover exactly the supplied chain segment. Failure code: `BATCH_INVALID`.
6. **Anchor reference:** the anchor root equals the last range's global root, and the chain ID, positive sequence, contract address, and transaction hash are valid. Failure code: `ANCHOR_INVALID`.

A missing interior event or reordered event fails `CHAIN_INVALID`. Removing a trailing event while retaining the original covering range fails `BATCH_INVALID`. Error detail text is diagnostic only and is not stable. A valid verdict has `valid: true` and no reason code.

With RPC checking enabled, the operator separately supplies the expected registry address. The verifier checks `eth_chainId` and calls `rootAt(anchor.sequence)` (`0xeaa38b41` followed by the sequence as a 32-byte big-endian word); the result must equal `anchor.root`. RPC mode does not verify the transaction receipt or establish that the address is the intended deployed registry.

## Limits and cross-language vectors

A valid bundle proves integrity and inclusion only for its supplied segment and claims. It does not prove the segment is complete, the starting checkpoint is authentic, event contents are truthful or authorized, or that different users received the same root. The root publisher controls publication. No production publication pipeline or deployed registry is implied; the Amoy manifest remains a template.

The initial README delegated details of proof validation order and how truncation is classified without specifying them. This revision resolves that ambiguity using the order and rules above; the independent implementation and published vectors follow this text. `packages/verifier/vectors/v1/index.json` indexes valid, malformed, truncated, and tampered bundles with exact verdicts. `verifiers/python/yen_verify.py` implements this document using Python's standard library. CI runs both implementations on every indexed vector and compares their verdicts to the index. The Ubuntu runner's existing `python3` is used; no Python setup action is added.
