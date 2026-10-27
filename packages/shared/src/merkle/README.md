# Event inclusion proofs

`verifyEventProof(bundle, expectedGlobalRoot)` checks that a salted event hash belongs
to a fund tree whose root and fingerprint belong to the expected interval root.
The expected root must come from an authenticated source outside the bundle.
Assuming SHA-256 collision resistance, any change would be detected when the committed
event data is checked against that root.

The byte formulas are:

```text
event leaf  = SHA256(0x00 || salt[32] || eventHash[32])
node        = SHA256(0x01 || left[32] || right[32])
fingerprint = SHA256(0x03 || fundId[16 UUID bytes] || latestEventHash[32])
fund leaf   = SHA256(0x02 || u64be(eventCount) || fundRoot[32] || fingerprint[32])
global root = SHA256(0x04 || u64be(fundCount) || merkleRoot(fundLeaves)[32])
empty root  = SHA256(empty input)
```

`u64be` encodes a count in eight unsigned big-endian bytes. Counts are nonnegative
safe integers. An empty fund's `fundRoot` is the empty root and its fund leaf commits
to event count zero. An interval with zero funds has global root
`SHA256(0x04 || u64be(0) || SHA256(empty input))`. `IntervalTree.root` returns the
wrapped global root, a single 32-byte value intended for anchoring.

Trees use the [RFC 6962 §2.1](https://www.rfc-editor.org/rfc/rfc6962.html#section-2.1)
split at the largest power of two below the size. Odd nodes are never duplicated.
`buildIntervalTree(funds)` orders events by distinct, nonnegative safe-integer `seq`
and funds by their canonical lowercase UUID bytes. The latest hash must match the
highest sequence for a nonempty fund. Idle funds retain their supplied latest hash.
`proveEvent(tree, fundId, seq)` selects the event by sequence, not array position.
Callers provide independent random 32-byte salts and keep them secret until disclosure.

`parseEventProof(input)` and `parseEventProofJson(json)` return a `Result<EventProof>`.
The versioned bundle requires both inclusion paths, the salt, event hash, fund ID,
and latest event hash. Hashes and salts use exactly 64 lowercase hex characters.
`parseHash32` validates an external expected root. `serializeEventProof` encodes a
typed bundle. Invalid encodings, indices, sizes, and path lengths return errors.
`verifyInclusion` accepts already-hashed leaves; `leafHash` supplies event domain separation.

A proof does not establish that an event is truthful, authorized, paid, or the only
event recorded. It does not establish completeness, sequence continuity, or consistency
between intervals. Sequence numbers are ordering inputs, not fields in the leaf hash.
The fingerprint binds the claimed fund ID and latest hash; conflicting roots still
require comparison through an authenticated publication channel.

Plain `verifyInclusion` uses RFC inclusion paths, which do not always authenticate
the exact tree size: the path for index 0 in a five-leaf tree can also verify with
size 7. The two-level `verifyEventProof` closes this limitation by committing to
`eventProof.size` in the fund leaf and `fundProof.size` in the global root; any change
would be detected against the authenticated global root. Identical event leaves can
still have interchangeable proofs at occupied indices. Distinct occurrences require
separately authenticated metadata.

Only the global root is intended for public publication. Fund IDs enter hash inputs
but do not appear in that published root. A disclosed proof bundle contains its fund
ID and salt and is intended for its authorized recipient. A root alone neither hides
already-disclosed data nor guarantees data availability.

The independent Python fixtures regenerate with
`python3 packages/shared/test-vectors/generate_merkle_vectors.py` from the repository root.
Published CT test vectors are not used. Portability tests require esbuild to build
an ESM bundle with `platform: "browser"` and reject every `node:` import. They compare
valid and tampered proofs in Node and the browser bundle, executing the bundle in a
restricted VM with only WebCrypto, TextEncoder, and Uint8Array supplied as host globals.

## Prior art

- [RFC 6962](../../../../docs/REFERENCES.md#rfc-6962) supplies the split and node domains; Yen adds salts and count commitments.
- [Crosby and Wallach](../../../../docs/REFERENCES.md#crosby-wallach) motivate inclusion and consistency auditing; Yen does not implement consistency proofs.
- [RFC 9162](../../../../docs/REFERENCES.md#rfc-9162) discusses comparison of log views; inclusion alone does not prevent split views.
