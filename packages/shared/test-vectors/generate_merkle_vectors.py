#!/usr/bin/env python3
"""Independent reference for the Yen Merkle spec. Writes merkle.json next to this file.

Spec, written from RFC 6962 section 2.1 rather than from the TypeScript code:
  event leaf  = SHA256(0x00 || salt || eventHash)
  node        = SHA256(0x01 || left || right)
  empty tree  = SHA256("")
  shape       = split at the largest power of two strictly below n
  fund root   = tree over the fund's event leaves, in seq order
  fingerprint = SHA256(0x03 || fundId as 16 UUID bytes || latestEventHash)
  fund leaf   = SHA256(0x02 || fundRoot || fingerprint)
  global root = tree over fund leaves, funds sorted by fundId bytes

Run: python3 packages/shared/test-vectors/generate_merkle_vectors.py
Uses only the standard library.
"""

import hashlib
import json
import pathlib

LINE_WIDTH = 100
PROOF_FORMAT = "yen/event-proof/v1"


def sha256(*parts: bytes) -> bytes:
    return hashlib.sha256(b"".join(parts)).digest()


def split(n: int) -> int:
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def mth(leaves: list[bytes]) -> bytes:
    if not leaves:
        return sha256()
    if len(leaves) == 1:
        return leaves[0]
    k = split(len(leaves))
    return sha256(b"\x01", mth(leaves[:k]), mth(leaves[k:]))


def path(m: int, leaves: list[bytes]) -> list[bytes]:
    if len(leaves) <= 1:
        return []
    k = split(len(leaves))
    if m < k:
        return path(m, leaves[:k]) + [mth(leaves[k:])]
    return path(m - k, leaves[k:]) + [mth(leaves[:k])]


def event_leaf(salt: bytes, event_hash: bytes) -> bytes:
    return sha256(b"\x00", salt, event_hash)


def uuid_bytes(fund_id: str) -> bytes:
    raw = bytes.fromhex(fund_id.replace("-", ""))
    assert len(raw) == 16 and fund_id == fund_id.lower()
    return raw


def fingerprint(fund_id: str, latest_event_hash: bytes) -> bytes:
    return sha256(b"\x03", uuid_bytes(fund_id), latest_event_hash)


def derive(label: str) -> bytes:
    return sha256(b"yen-test-vector/", label.encode())


def derive_uuid(label: str) -> str:
    h = derive(label)[:16].hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def leaf_vectors(count: int) -> list[dict]:
    out = []
    for i in range(count):
        salt = derive(f"leaf/{i}/salt")
        event_hash = derive(f"leaf/{i}/event")
        out.append(
            {"salt": salt.hex(), "eventHash": event_hash.hex(), "leaf": event_leaf(salt, event_hash).hex()}
        )
    return out


def tree_vectors(leaves: list[bytes], sizes: list[int], proved_indices) -> list[dict]:
    out = []
    for n in sizes:
        subset = leaves[:n]
        out.append(
            {
                "size": n,
                "root": mth(subset).hex(),
                "proofs": [
                    {"index": i, "path": [p.hex() for p in path(i, subset)]} for i in proved_indices(n)
                ],
            }
        )
    return out


def interval_vector(name: str, event_counts: list[int]) -> dict:
    funds = []
    for f, count in enumerate(event_counts):
        events = [
            (derive(f"{name}/{f}/{j}/salt"), derive(f"{name}/{f}/{j}/event")) for j in range(count)
        ]
        latest = events[-1][1] if events else derive(f"{name}/{f}/latest-before-interval")
        funds.append({"fundId": derive_uuid(f"{name}/{f}/id"), "events": events, "latest": latest})

    ordered = sorted(funds, key=lambda fund: uuid_bytes(fund["fundId"]))
    fund_trees = []
    for fund in ordered:
        leaves = [event_leaf(s, e) for s, e in fund["events"]]
        root = mth(leaves)
        fund_leaf = sha256(b"\x02", root, fingerprint(fund["fundId"], fund["latest"]))
        fund_trees.append((fund, leaves, root, fund_leaf))
    fund_leaves = [t[3] for t in fund_trees]

    proofs = []
    for position, (fund, leaves, _, _) in enumerate(fund_trees):
        for j, (salt, event_hash) in enumerate(fund["events"]):
            proofs.append(
                {
                    "format": PROOF_FORMAT,
                    "salt": salt.hex(),
                    "eventHash": event_hash.hex(),
                    "eventProof": {
                        "index": j,
                        "size": len(leaves),
                        "path": [p.hex() for p in path(j, leaves)],
                    },
                    "fundId": fund["fundId"],
                    "latestEventHash": fund["latest"].hex(),
                    "fundProof": {
                        "index": position,
                        "size": len(fund_leaves),
                        "path": [p.hex() for p in path(position, fund_leaves)],
                    },
                }
            )

    roots = {t[0]["fundId"]: t[2].hex() for t in fund_trees}
    return {
        "name": name,
        "funds": [
            {
                "fundId": fund["fundId"],
                "latestEventHash": fund["latest"].hex(),
                "events": [{"salt": s.hex(), "eventHash": e.hex()} for s, e in fund["events"]],
                "fundRoot": roots[fund["fundId"]],
            }
            for fund in funds
        ],
        "root": mth(fund_leaves).hex(),
        "proofs": proofs,
    }


def build() -> dict:
    leaves = leaf_vectors(257)
    leaf_hashes = [bytes.fromhex(v["leaf"]) for v in leaves]
    small = list(range(18))
    large = [31, 32, 33, 64, 100, 257]
    return {
        "leaves": leaves,
        "trees": tree_vectors(leaf_hashes, small, lambda n: range(n))
        + tree_vectors(leaf_hashes, large, lambda n: sorted({0, 1, n // 2, n - 2, n - 1})),
        "fingerprints": [
            {
                "fundId": fund_id,
                "latestEventHash": latest.hex(),
                "fingerprint": fingerprint(fund_id, latest).hex(),
            }
            for fund_id, latest in [
                (derive_uuid(f"fingerprint/{i}/id"), derive(f"fingerprint/{i}/latest")) for i in range(4)
            ]
            + [("00000000-0000-0000-0000-000000000000", bytes(32))]
        ],
        "intervals": [
            interval_vector("no-funds", []),
            interval_vector("one-fund-one-event", [1]),
            interval_vector("idle-fund", [3, 0, 5]),
            interval_vector("five-funds", [1, 2, 3, 4, 7]),
        ],
    }


def emit(value, indent: int, column: int) -> str:
    """JSON laid out the way Biome formats it, so the committed file passes `biome ci` as generated."""
    pad = " " * indent
    inner = " " * (indent + 2)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = []
        for key, item in value.items():
            prefix = f"{json.dumps(key)}: "
            items.append(f"{inner}{prefix}{emit(item, indent + 2, indent + 2 + len(prefix))}")
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(item, (dict, list)) for item in value):
            flat = "[" + ", ".join(json.dumps(item) for item in value) + "]"
            if column + len(flat) + 1 <= LINE_WIDTH:
                return flat
        items = [f"{inner}{emit(item, indent + 2, indent + 2)}" for item in value]
        return "[\n" + ",\n".join(items) + f"\n{pad}]"
    return json.dumps(value)


if __name__ == "__main__":
    target = pathlib.Path(__file__).with_name("merkle.json")
    target.write_text(emit(build(), 0, 0) + "\n")
