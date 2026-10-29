# Standalone audit bundle verifier

`@yen/verifier` is a small command line verifier implemented with Node built-ins only. Its runtime code imports no `@yen/*` package. Install the published package and run:

```sh
yen-verify bundle.json
yen-verify bundle.json --rpc https://your-rpc.example --contract 0xYourRootRegistry
```

Without `--rpc`, the tool checks event hashes, chain order/links, Merkle proofs, batch metadata and the bundle's anchor reference. With `--rpc`, it also checks `eth_chainId` and calls `RootRegistry.rootAt(anchor.sequence)` using `eth_call`; the RPC URL and expected registry address come from the verifier operator. Check the contract deployment independently before trusting that address. The recorded transaction hash is a reference, not a transaction-receipt proof.

## Bundle format v1

The JSON object has `format: "yen/audit-bundle/v1"`, `fund_id`, `chain`, `events`, `roots`, and `anchor`:

- `chain` is the authenticated preceding sequence and hash. Events begin at `start_seq + 1` and must be contiguous, fund-bound, and linked through `prev_hash`; use `{ "start_seq": 0, "start_hash": "000…000" }` for genesis.
- Each `events[]` item contains an `event` in the unchanged nine-field `@yen/eventlog` envelope form, the 32-byte `salt`, the fund's `latest_event_hash`, and `eventProof` and `fundProof` (`index`, `size`, `path`) in `@yen/shared` form.
- Each `roots[]` entry states an inclusive event sequence range, that fund's `event_root`, `fund_count`, and the wrapped `global_root`.
- `anchor` contains `chain_id`, `contract_address`, `sequence`, `tx_hash`, and `root`. When RPC checking is enabled, `root` is compared with the registry's `rootAt(sequence)` result.

Each root range covers every event sequence in that interval. The final event hash in the range must equal the proof's `latest_event_hash`; the fingerprint then binds that value and the fund ID into the global root.

Hashes and salts are 64 lowercase hexadecimal digits; transaction hashes and addresses are `0x`-prefixed. Canonical event hashing follows the eventlog v1 domain (`yen/eventlog/event/v1\0`) and RFC 8785 JSON Canonicalization Scheme. The verifier uses the RFC 6962 tree split and Yen's existing salted leaf, node, fingerprint, count and global-root domains. It does not redefine those formats.

## What a pass establishes

A pass establishes that the supplied JSON's events hash to their stated hashes, form the supplied contiguous chain segment, and have inclusion paths matching the stated root. If the chain has an authenticated starting head and the registry address and chain are independently trusted, RPC mode additionally establishes that the specified root is currently returned at that registry sequence.

A pass does **not** prove the bundle includes every event, the starting head is authentic unless checked independently, records are truthful or authorized, a bank matched a transaction, a real-world spend happened, or that two users were shown the same root. The RootRegistry publisher controls publication. A root and proof establish integrity/inclusion, not completeness, consistency across intervals, availability, or economic truth. Polygon Amoy is a test network and may reset.

The tests use `@yen/eventlog` and `@yen/shared` only to create independent cross-check fixtures. Production verifier imports only `node:crypto` and other Node built-ins.
