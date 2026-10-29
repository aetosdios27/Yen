#!/usr/bin/env python3
"""Generate independent RFC 8785 and Yen event-chain fixtures with the Python standard library."""

import hashlib
import json
import math
from decimal import Decimal
from pathlib import Path

DOMAIN = b"yen/eventlog/event/v1\x00"
GENESIS = "00" * 32
WIDTH = 100


def normalized_string(value):
    characters = []
    index = 0
    while index < len(value):
        char = value[index]
        unit = ord(char)
        if 0xD800 <= unit <= 0xDBFF:
            if index + 1 >= len(value) or not 0xDC00 <= ord(value[index + 1]) <= 0xDFFF:
                raise ValueError("lone surrogate")
            low = ord(value[index + 1])
            characters.append(chr(0x10000 + ((unit - 0xD800) << 10) + low - 0xDC00))
            index += 2
        elif 0xDC00 <= unit <= 0xDFFF:
            raise ValueError("lone surrogate")
        else:
            characters.append(char)
            index += 1
    return "".join(characters)


def js_number(value):
    if not math.isfinite(value):
        raise ValueError("non-finite number")
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    magnitude = abs(value)
    decimal = Decimal(repr(magnitude)).normalize()
    if 1e-6 <= magnitude < 1e21:
        return sign + format(decimal, "f")
    mantissa, exponent = format(decimal, "e").split("e")
    exponent_number = int(exponent)
    exponent_text = f"+{exponent_number}" if exponent_number >= 0 else str(exponent_number)
    return f"{sign}{mantissa}e{exponent_text}"


def canonical(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(normalized_string(value), ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        return js_number(float(value))
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        normalized = [(normalized_string(key), item) for key, item in value.items()]
        if len({key for key, _ in normalized}) != len(normalized):
            raise ValueError("duplicate normalized key")
        entries = sorted(normalized, key=lambda entry: entry[0].encode("utf-16-be"))
        return "{" + ",".join(canonical(key) + ":" + canonical(item) for key, item in entries) + "}"
    raise ValueError("not JSON")


def derive_uuid(label):
    raw = hashlib.sha256(f"yen/eventlog/vector/{label}".encode()).hexdigest()[:32]
    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def payloads():
    uid = derive_uuid
    bank = uid("bank-transaction")
    expense = uid("expense")
    donation = uid("donation")
    objection = uid("objection")
    discrepancy = uid("discrepancy")
    return [
        ("fund.created", {"org_id": uid("org"), "visibility": "private"}),
        ("fund.policy_changed", {"approval_quorum": 2, "objection_window_hours": 48}),
        ("fund.visibility_changed", {"visibility": "members"}),
        ("member.added", {"member_id": "psn_" + uid("member"), "role": "approver"}),
        ("member.removed", {"member_id": "psn_" + uid("member")}),
        ("donation.pledged", {"donation_id": donation, "amount_paise": 12345}),
        ("donation.verified", {"donation_id": donation, "bank_transaction_id": bank}),
        ("donation.rejected", {"donation_id": donation, "reason": "unmatched"}),
        ("expense.submitted", {"expense_id": expense, "amount_paise": 6500}),
        ("expense.evidence_added", {"expense_id": expense, "evidence_id": uid("evidence"), "content_sha256": "ab" * 32}),
        ("expense.flagged", {"expense_id": expense, "reason": "missing_evidence"}),
        ("expense.objection_raised", {"expense_id": expense, "objection_id": objection}),
        ("expense.objection_resolved", {"expense_id": expense, "objection_id": objection, "resolution": "dismissed"}),
        ("expense.approved", {"expense_id": expense}),
        ("expense.rejected", {"expense_id": expense, "reason": "policy"}),
        ("expense.expired", {"expense_id": expense}),
        ("expense.paid", {"expense_id": expense, "bank_transaction_id": bank}),
        ("expense.reversed", {"expense_id": expense, "bank_transaction_id": bank}),
        ("bank.credit_seen", {"bank_transaction_id": bank, "amount_paise": 12345}),
        ("bank.debit_seen", {"bank_transaction_id": bank, "amount_paise": 6500}),
        ("bank.balance_checked", {"balance_paise": -125}),
        ("discrepancy.raised", {"discrepancy_id": discrepancy, "bank_transaction_id": bank, "kind": "balance_mismatch"}),
        ("discrepancy.resolved", {"discrepancy_id": discrepancy, "resolution": "corrected"}),
        ("anchor.published", {"anchor_id": uid("anchor"), "global_root": "cd" * 32}),
    ]


def golden_events():
    events = []
    previous = GENESIS
    for index, (event_type, payload) in enumerate(payloads()):
        envelope = {
            "fund_id": derive_uuid("fund"),
            "seq": index + 1,
            "type": event_type,
            "version": 1,
            "actor": "psn_" + derive_uuid("actor-pseudonym"),
            "occurred_at": f"2026-01-01T00:{index:02d}:00.000Z",
            "payload": payload,
            "prev_hash": previous,
        }
        encoded = canonical(envelope)
        event_hash = hashlib.sha256(DOMAIN + encoded.encode("utf-8")).hexdigest()
        events.append({"event": {**envelope, "hash": event_hash}, "canonical": encoded})
        previous = event_hash
    index = len(events)
    envelope = {
        "fund_id": derive_uuid("fund"),
        "seq": index + 1,
        "type": "fund.visibility_changed",
        "version": 2,
        "actor": "psn_" + derive_uuid("actor-pseudonym"),
        "occurred_at": f"2026-01-01T00:{index:02d}:00.000Z",
        "payload": {"old_visibility": "private", "new_visibility": "public"},
        "prev_hash": previous,
    }
    encoded = canonical(envelope)
    event_hash = hashlib.sha256(DOMAIN + encoded.encode("utf-8")).hexdigest()
    events.append({"event": {**envelope, "hash": event_hash}, "canonical": encoded})
    previous = event_hash
    index = len(events)
    envelope = {
        "fund_id": derive_uuid("fund"),
        "seq": index + 1,
        "type": "fund.payee_changed",
        "version": 1,
        "actor": "psn_" + derive_uuid("actor-pseudonym"),
        "occurred_at": f"2026-01-01T00:{index:02d}:00.000Z",
        "payload": {},
        "prev_hash": previous,
    }
    encoded = canonical(envelope)
    event_hash = hashlib.sha256(DOMAIN + encoded.encode("utf-8")).hexdigest()
    events.append({"event": {**envelope, "hash": event_hash}, "canonical": encoded})
    previous = event_hash
    previous = event_hash
    index = len(events)
    envelope = {
        "fund_id": derive_uuid("fund"),
        "seq": index + 1,
        "type": "expense.objection_raised",
        "version": 2,
        "actor": "psn_" + derive_uuid("actor-pseudonym"),
        "occurred_at": f"2026-01-01T00:{index:02d}:00.000Z",
        "payload": {"expense_id": derive_uuid("expense"), "objection_id": derive_uuid("objection")},
        "prev_hash": previous,
    }
    encoded = canonical(envelope)
    event_hash = hashlib.sha256(DOMAIN + encoded.encode("utf-8")).hexdigest()
    events.append({"event": {**envelope, "hash": event_hash}, "canonical": encoded})
    previous = event_hash
    return {"domain_utf8": DOMAIN.decode("utf-8"), "genesis_hash": GENESIS, "latest_hash": previous, "events": events}


def canonical_vectors():
    cases = [
        ("rfc_numbers", [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27]),
        ("rfc_strings", {"\u20ac": "Euro Sign", "\r": "Carriage Return", "\ufb33": "Hebrew Letter Dalet With Dagesh", "1": "One", "\U0001f600": "Grinning Face", "\u0080": "Control", "\u00f6": "Latin Small Letter O With Diaeresis"}),
        ("nested", {"z": [{"b": 2, "a": [True, None, "😀"]}], "a": {"𐀀": "line\n\t\\\"", "\ue000": "\u2028"}}),
        ("numbers_edges", [1e21, 1e-7, -0.0, 0.1 + 0.2, 1e-6, 1e20]),
        ("escapes", "\b\t\n\f\r\x00\x1f/\\\""),
        ("utf16_sort", {"\ue000": 1, "𐀀": 2, "A": 3}),
        ("surrogate_pair", "\ud83d\ude00"),
        ("line_separator", "\u2028"),
        ("paragraph_separator", "\u2029"),
        ("delete_control", "\u007f"),
    ]
    result = [{"name": name, "input": value, "canonical": canonical(value)} for name, value in cases]
    lone_surrogate = "\ud800"
    try:
        canonical(lone_surrogate)
    except ValueError as error:
        result.append({"name": "lone_surrogate", "input": lone_surrogate, "error": str(error)})
    else:
        raise AssertionError("lone surrogate was accepted")
    return result


def display_scalar(value):
    if isinstance(value, float) and "e" in repr(value):
        mantissa, exponent = repr(value).split("e")
        return f"{mantissa}e{int(exponent)}"
    if isinstance(value, str):
        try:
            return json.dumps(normalized_string(value), ensure_ascii=False)
        except ValueError:
            return json.dumps(value, ensure_ascii=True)
    return json.dumps(value, ensure_ascii=False)


def emit(value, indent=0, column=0):
    pad = " " * indent
    inner = " " * (indent + 2)
    if isinstance(value, dict):
        if not value:
            return "{}"
        entries = []
        for key, item in value.items():
            prefix = f"{display_scalar(key)}: "
            entries.append(f"{inner}{prefix}{emit(item, indent + 2, indent + 2 + len(prefix))}")
        return "{\n" + ",\n".join(entries) + f"\n{pad}}}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(item, (dict, list)) for item in value):
            flat = "[" + ", ".join(display_scalar(item) for item in value) + "]"
            if column + len(flat) + 1 <= WIDTH:
                return flat
        return "[\n" + ",\n".join(f"{inner}{emit(item, indent + 2, indent + 2)}" for item in value) + f"\n{pad}]"
    return display_scalar(value)


if __name__ == "__main__":
    directory = Path(__file__).parent
    (directory / "canonical-vectors.json").write_text(emit(canonical_vectors()) + "\n", encoding="utf-8")
    (directory / "golden-events.json").write_text(emit(golden_events()) + "\n", encoding="utf-8")
