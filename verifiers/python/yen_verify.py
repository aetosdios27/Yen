#!/usr/bin/env python3
"""Independent stdlib verifier for audit bundle v1, implemented from the written spec."""
import hashlib
import json
import math
import re
from decimal import Decimal

REASONS = ("FORMAT_INVALID", "EVENT_HASH_INVALID", "CHAIN_INVALID", "PROOF_INVALID", "BATCH_INVALID", "ANCHOR_INVALID")

def safe_int(value, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1

def sha(*parts):
    h = hashlib.sha256()
    for part in parts:
        h.update(part)
    return h.digest()

def canonical(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        if abs(value) > 2**53 - 1:
            raise ValueError("integer outside the interoperable JSON range")
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("JCS requires finite numbers")
        if value == 0:
            return "0"
        magnitude = abs(value)
        shortest = repr(value).lower()
        if 1e-6 <= magnitude < 1e21:
            decimal = format(Decimal(shortest), "f")
            return decimal.rstrip("0").rstrip(".") if "." in decimal else decimal
        mantissa, marker, exponent = shortest.partition("e")
        if not marker:
            mantissa, exponent = format(Decimal(shortest).normalize(), "E").lower().split("e")
        mantissa = mantissa.rstrip("0").rstrip(".") if "." in mantissa else mantissa
        power = int(exponent)
        return f"{mantissa}e{'+' if power >= 0 else ''}{power}"
    if isinstance(value, str):
        if any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("JCS rejects lone surrogates")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(canonical(k) + ":" + canonical(value[k]) for k in keys) + "}"
    raise ValueError("unsupported JSON value")

def unhex(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("expected lowercase 32-byte hex")
    return bytes.fromhex(value)

def u64(value):
    if not isinstance(value, int) or value < 0 or value > 2**53 - 1:
        raise ValueError("invalid count")
    return value.to_bytes(8, "big")

def root_from_inclusion(proof, value):
    index, size = proof["index"], proof["size"]
    if not isinstance(index, int) or not isinstance(size, int) or size < 1 or index < 0 or index >= size:
        return None
    result = value
    for sibling_hex in proof["path"]:
        if size == 1:
            return None
        sibling = unhex(sibling_hex)
        if index % 2 == 1 or index == size - 1:
            result = sha(b"\x01", sibling, result)
            while index % 2 == 0 and index != 0:
                index //= 2
                size //= 2
        else:
            result = sha(b"\x01", result, sibling)
        index //= 2
        size //= 2
    return result if size == 1 else None

def wrapped(entry, fund_id):
    unsigned = {k: v for k, v in entry["event"].items() if k != "hash"}
    event_hash = sha(b"yen/eventlog/event/v1\x00", canonical(unsigned).encode())
    event_root = root_from_inclusion(entry["eventProof"], sha(b"\x00", unhex(entry["salt"]), unhex(entry["event"]["hash"])))
    if event_root is None:
        raise ValueError("invalid event proof")
    fingerprint = sha(b"\x03", bytes.fromhex(fund_id.replace("-", "")), unhex(entry["latest_event_hash"]))
    fund_leaf = sha(b"\x02", u64(entry["eventProof"]["size"]), event_root, fingerprint)
    global_tree = root_from_inclusion(entry["fundProof"], fund_leaf)
    if global_tree is None:
        raise ValueError("invalid fund proof")
    return event_hash.hex(), event_root.hex(), sha(b"\x04", u64(entry["fundProof"]["size"]), global_tree).hex(), entry["fundProof"]["size"]

def verify(bundle):
    try:
        if not isinstance(bundle, dict) or bundle.get("format") != "yen/audit-bundle/v1" or not isinstance(bundle.get("events"), list) or not bundle["events"] or not isinstance(bundle.get("roots"), list) or not isinstance(bundle.get("anchor"), dict) or not isinstance(bundle.get("chain"), dict):
            return False, "FORMAT_INVALID"
        if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", bundle.get("fund_id", "")):
            return False, "FORMAT_INVALID"
        chain = bundle["chain"]
        anchor = bundle["anchor"]
        if not safe_int(chain.get("start_seq")) or not safe_int(anchor.get("chain_id"), 1) or not safe_int(anchor.get("sequence"), 1):
            return False, "FORMAT_INVALID"
        unhex(chain["start_hash"])
        unhex(anchor["root"])
        for root in bundle["roots"]:
            if not safe_int(root.get("start_seq")) or not safe_int(root.get("end_seq")) or not safe_int(root.get("fund_count"), 1):
                return False, "FORMAT_INVALID"
            unhex(root["event_root"])
            unhex(root["global_root"])
        prev, seq, previous_time = chain["start_hash"], chain["start_seq"] + 1, ""
        event_keys = {"fund_id", "seq", "type", "version", "actor", "occurred_at", "payload", "prev_hash", "hash"}
        for entry in bundle["events"]:
            event = entry["event"]
            if set(event) != event_keys:
                return False, "EVENT_HASH_INVALID"
            computed = sha(b"yen/eventlog/event/v1\x00", canonical({k: v for k, v in event.items() if k != "hash"}).encode()).hex()
            if computed != event.get("hash"):
                return False, "EVENT_HASH_INVALID"
            timestamp = event.get("occurred_at", "")
            if event.get("fund_id") != bundle["fund_id"] or event.get("seq") != seq or event.get("prev_hash") != prev or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", timestamp) or (previous_time and timestamp < previous_time):
                return False, "CHAIN_INVALID"
            prev, seq, previous_time = event["hash"], seq + 1, timestamp
        for entry in bundle["events"]:
            try:
                computed_hash, event_root, global_root, fund_count = wrapped(entry, bundle["fund_id"])
            except (KeyError, TypeError, ValueError, OverflowError):
                return False, "PROOF_INVALID"
            matching = next((r for r in bundle["roots"] if r["start_seq"] <= entry["event"]["seq"] <= r["end_seq"]), None)
            if matching is None or entry["event"]["seq"] != entry["eventProof"]["index"] + matching["start_seq"] or entry["eventProof"]["size"] != matching["end_seq"] - matching["start_seq"] + 1 or (entry["event"]["seq"] == matching["end_seq"] and computed_hash != entry["latest_event_hash"]) or event_root != matching["event_root"] or fund_count != matching["fund_count"] or global_root != matching["global_root"]:
                return False, "PROOF_INVALID"
        expected = chain["start_seq"] + 1
        for root in bundle["roots"]:
            if root["start_seq"] != expected or root["end_seq"] < root["start_seq"] or root["end_seq"] >= seq:
                return False, "BATCH_INVALID"
            expected = root["end_seq"] + 1
        if expected != seq:
            return False, "BATCH_INVALID"
        if anchor["root"] != bundle["roots"][-1]["global_root"] or not re.fullmatch(r"0x[0-9a-fA-F]{40}", anchor["contract_address"]) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", anchor["tx_hash"]):
            return False, "ANCHOR_INVALID"
        return True, None
    except (KeyError, TypeError, ValueError, OverflowError):
        return False, "FORMAT_INVALID"

if __name__ == "__main__":
    import argparse
    import sys
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle_file")
    parser.add_argument("--rpc")
    parser.add_argument("--contract")
    args = parser.parse_args()
    with open(args.bundle_file, encoding="utf-8") as source:
        vector = json.load(source, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"invalid JSON number {value}")))
    bundle = vector.get("bundle", vector)
    valid, code = verify(bundle)
    if valid and args.rpc:
        import urllib.request
        def rpc(method, params):
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
            request = urllib.request.Request(args.rpc, data=body, headers={"content-type": "application/json"})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)["result"]
        try:
            if not args.contract or int(rpc("eth_chainId", []), 16) != bundle["anchor"]["chain_id"] or args.contract.lower() != bundle["anchor"]["contract_address"].lower():
                valid, code = False, "ANCHOR_INVALID"
            else:
                call_data = "0xeaa38b41" + format(bundle["anchor"]["sequence"], "064x")
                result = rpc("eth_call", [{"to": args.contract, "data": call_data}, "latest"])
                if result.lower() != bundle["anchor"]["root"].lower():
                    valid, code = False, "ANCHOR_INVALID"
        except Exception as error:
            print(f"RPC verification failed: {error}", file=sys.stderr)
            valid, code = False, "ANCHOR_INVALID"
    print(json.dumps({"valid": valid, "reason_code": code}, sort_keys=True))
