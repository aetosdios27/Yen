import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import vectors from "../../test-vectors/merkle.json" with { type: "json" };
import { type Hash32, type Salt32, toHex } from "./hash.js";
import { verifyEventProof } from "./interval.js";
import {
  type EventProof,
  parseEventProof,
  parseEventProofJson,
  parseFundId,
  parseHash32,
  parseInclusionProof,
  parseSalt32,
  serializeEventProof,
} from "./proof.js";

const interval = vectors.intervals.find((vector) => vector.name === "five-funds");
const wire = interval?.proofs.find(
  (proof) => proof.eventProof.path.length > 0 && proof.fundProof.path.length > 0,
);
if (wire === undefined || interval === undefined)
  throw new Error("Nested fixture with both proof paths");
const root = parseHash32(interval.root);
if (!root.ok) throw new Error(root.error);

describe("untrusted proof boundary", () => {
  it("round-trips the entire typed bundle through JSON and verifies", async () => {
    const parsed = parseEventProofJson(JSON.stringify(wire));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(JSON.parse(serializeEventProof(parsed.value))).toEqual(wire);
    expect(await verifyEventProof(parsed.value, root.value)).toBe(true);
    expect(toHex(parsed.value.eventHash)).toBe(wire.eventHash);
  });

  it.each(["", "{", "undefined", "[", '{"format":}'])(
    "returns an error for malformed JSON %j",
    (json) => {
      expect(parseEventProofJson(json).ok).toBe(false);
    },
  );

  it.each([
    null,
    false,
    1,
    "proof",
    [],
    {},
    { ...wire, extra: 1 },
    { ...wire, format: "yen/event-proof/v2" },
  ])("rejects wrong bundle shape %j", (value) => {
    expect(parseEventProof(value).ok).toBe(false);
  });

  it("rejects unknown keys in proof JSON", () => {
    expect(parseEventProofJson(JSON.stringify({ ...wire, extra: 1 })).ok).toBe(false);
  });

  it("requires every bundle field and both inclusion levels", () => {
    for (const key of Object.keys(wire)) {
      const partial: Record<string, unknown> = { ...wire };
      delete partial[key];
      expect(parseEventProof(partial).ok).toBe(false);
    }
    expectTypeOf<Omit<EventProof, "fundProof">>().not.toExtend<EventProof>();
    expectTypeOf<Omit<EventProof, "eventProof">>().not.toExtend<EventProof>();
    expectTypeOf<Hash32>().not.toExtend<Salt32>();
    expectTypeOf<Salt32>().not.toExtend<Hash32>();
  });

  it("rejects wrong lengths, uppercase, odd-length, non-hex and non-string bytes at every position", () => {
    const badBytes = [
      "",
      "00".repeat(31),
      "00".repeat(33),
      "0".repeat(63),
      `${"ff".repeat(31)}gg`,
      "AB".repeat(32),
      ` ${"00".repeat(32)}`,
      [],
      null,
      123,
    ];
    for (const value of badBytes) {
      expect(parseHash32(value).ok).toBe(false);
      expect(parseSalt32(value).ok).toBe(false);
      for (const key of ["salt", "eventHash", "latestEventHash"]) {
        expect(parseEventProof({ ...wire, [key]: value }).ok).toBe(false);
      }
      for (const key of ["eventProof", "fundProof"] as const) {
        const proof = wire[key];
        expect(
          parseEventProof({
            ...wire,
            [key]: { ...proof, path: proof.path.map((element, i) => (i === 0 ? value : element)) },
          }).ok,
        ).toBe(false);
      }
    }
  });

  it.each([
    "",
    "0".repeat(32),
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    "00000000-0000-0000-0000-00000000000g",
    null,
    1,
  ])("rejects noncanonical UUID %j", (fundId) => {
    expect(parseFundId(fundId).ok).toBe(false);
    expect(parseEventProof({ ...wire, fundId }).ok).toBe(false);
  });

  it("rejects invalid indices, sizes, short paths and extra elements at both levels", () => {
    for (const key of ["eventProof", "fundProof"] as const) {
      const proof = wire[key];
      const invalidProofs = [
        null,
        [],
        {},
        { ...proof, extra: 1 },
        { ...proof, path: "bad" },
        { ...proof, index: -1 },
        { ...proof, index: proof.size },
        { ...proof, index: 0.5 },
        { ...proof, index: "0" },
        { ...proof, index: NaN },
        { ...proof, index: Infinity },
        { ...proof, index: Number.MAX_SAFE_INTEGER + 1 },
        ...[-1, 0, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((size) => ({
          ...proof,
          size,
        })),
        { ...proof, path: proof.path.slice(1) },
        { ...proof, path: [...proof.path, wire.eventHash] },
      ];
      for (const value of invalidProofs) {
        expect(parseInclusionProof(value).ok).toBe(false);
        expect(parseEventProof({ ...wire, [key]: value }).ok).toBe(false);
      }
    }
  });

  it("accepts safe sizes above 2^31 without truncation and caps path depth by the safe integer range", () => {
    for (const size of [2 ** 32 + 1, Number.MAX_SAFE_INTEGER]) {
      expect(
        parseInclusionProof({
          index: 0,
          size,
          path: Array(Math.ceil(Math.log2(size))).fill("00".repeat(32)),
        }).ok,
      ).toBe(true);
    }
    expect(
      parseInclusionProof({ index: 0, size: 1, path: Array(54).fill("00".repeat(32)) }).ok,
    ).toBe(false);
  });

  it("returns a typed result without throwing for arbitrary JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(typeof parseEventProof(value).ok).toBe("boolean");
        expect(typeof parseInclusionProof(value).ok).toBe("boolean");
        expect(typeof parseEventProofJson(JSON.stringify(value)).ok).toBe("boolean");
      }),
      { numRuns: 200 },
    );
  });

  it("rejects single-bit tampering of every nested path element", async () => {
    for (const key of ["eventProof", "fundProof"] as const) {
      const proof = wire[key];
      for (const index of proof.path.keys()) {
        const path = proof.path.map((hex, i) =>
          i === index ? (Number.parseInt(hex[0] ?? "0", 16) ^ 1).toString(16) + hex.slice(1) : hex,
        );
        const parsed = parseEventProof({ ...wire, [key]: { ...proof, path } });
        if (!parsed.ok) throw new Error(parsed.error);
        expect(await verifyEventProof(parsed.value, root.value)).toBe(false);
      }
    }
  });
});
