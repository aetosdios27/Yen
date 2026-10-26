import { describe, expect, it } from "vitest";
import { hash32, salt32, toHex } from "./hash.js";
import { buildIntervalTree, type IntervalFund, proveEvent, verifyEventProof } from "./interval.js";
import { parseEventProofJson, parseFundId, serializeEventProof } from "./proof.js";

const id = parseFundId("00000000-0000-0000-0000-000000000001");
const missingId = parseFundId("00000000-0000-0000-0000-000000000002");
if (!id.ok || !missingId.ok) throw new Error("Valid fixture UUIDs");
const fundId = id.value;
const unknownFundId = missingId.value;
const event = (seq: number) => ({
  seq,
  salt: salt32(new Uint8Array(32).fill(seq)),
  eventHash: hash32(new Uint8Array(32).fill(seq + 1)),
});
const fund = (): IntervalFund => {
  const first = event(1);
  const last = event(3);
  return { fundId, latestEventHash: hash32(last.eventHash), events: [last, first] };
};

describe("interval builder", () => {
  it("orders by sequence and looks up sequence rather than array index", async () => {
    const tree = await buildIntervalTree([fund()]);
    const first = await proveEvent(tree, fundId, 1);
    const last = await proveEvent(tree, fundId, 3);
    expect(first.eventProof.index).toBe(0);
    expect(last.eventProof.index).toBe(1);
    expect(await verifyEventProof(first, tree.root)).toBe(true);
    expect(await verifyEventProof(last, tree.root)).toBe(true);
  });

  it.each(["eventProof", "fundProof"] as const)(
    "rejects relabelled %s sizes, including the RFC five-versus-seven ambiguity",
    async (key) => {
      const events = Array.from({ length: 5 }, (_, seq) => event(seq));
      const funds = Array.from({ length: 5 }, (_, index) => {
        const id = parseFundId(
          `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, "0")}`,
        );
        if (!id.ok) throw new Error(id.error);
        return { ...fund(), fundId: id.value, latestEventHash: event(4).eventHash, events };
      });
      const tree = await buildIntervalTree(funds);
      const bundle = await proveEvent(tree, fundId, 0);
      expect(bundle.eventProof).toMatchObject({ index: 0, size: 5 });
      expect(bundle.fundProof).toMatchObject({ index: 0, size: 5 });
      expect(await verifyEventProof(bundle, tree.root)).toBe(true);
      const sizes = [4, 6, 7, 8];
      for (let bit = 0; bit < 53; bit++) {
        const mask = 2 ** bit;
        sizes.push(5 + (Math.floor(5 / mask) % 2 === 0 ? mask : -mask));
      }
      for (const size of sizes) {
        const tampered = { ...bundle, [key]: { ...bundle[key], size } };
        if (size === 7) {
          const parsed = parseEventProofJson(serializeEventProof(tampered));
          if (!parsed.ok) throw new Error(parsed.error);
          expect(await verifyEventProof(parsed.value, tree.root)).toBe(false);
        }
        expect(await verifyEventProof(tampered, tree.root)).toBe(false);
      }
    },
  );

  it("rejects duplicate funds and duplicate sequences", async () => {
    await expect(buildIntervalTree([fund(), fund()])).rejects.toThrow("Duplicate fund ID");
    const input = fund();
    const repeated = event(1);
    await expect(buildIntervalTree([{ ...input, events: [repeated, repeated] }])).rejects.toThrow(
      "Event sequences",
    );
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid sequence %s",
    async (seq) => {
      await expect(buildIntervalTree([{ ...fund(), events: [event(seq)] }])).rejects.toThrow(
        "Event sequences",
      );
    },
  );

  it("supports sequence zero and requires latest hash to match the highest sequence", async () => {
    const zero = event(0);
    const tree = await buildIntervalTree([
      { fundId, latestEventHash: zero.eventHash, events: [zero] },
    ]);
    expect(await verifyEventProof(await proveEvent(tree, fundId, 0), tree.root)).toBe(true);
    await expect(
      buildIntervalTree([{ ...fund(), latestEventHash: zero.eventHash }]),
    ).rejects.toThrow("Latest event hash");
  });

  it("cannot prove a missing fund, missing sequence, idle fund or empty interval", async () => {
    const tree = await buildIntervalTree([fund()]);
    await expect(proveEvent(tree, unknownFundId, 1)).rejects.toThrow(RangeError);
    await expect(proveEvent(tree, fundId, 2)).rejects.toThrow(RangeError);
    const idle = await buildIntervalTree([{ ...fund(), events: [] }]);
    await expect(proveEvent(idle, fundId, 1)).rejects.toThrow(RangeError);
    await expect(proveEvent(await buildIntervalTree([]), fundId, 1)).rejects.toThrow(RangeError);
  });

  it("snapshots inputs before awaiting, and returned roots and proofs cannot corrupt future proofs", async () => {
    const input = fund();
    const pending = buildIntervalTree([input]);
    for (const event of input.events) {
      event.salt.fill(0);
      event.eventHash.fill(0);
    }
    input.latestEventHash.fill(0);
    const tree = await pending;
    const expectedRoot = toHex(tree.root);
    tree.root.fill(0);
    for (const root of tree.fundRoots) root.fill(0);
    const old = await proveEvent(tree, fundId, 1);
    old.salt.fill(0);
    old.eventHash.fill(0);
    old.latestEventHash.fill(0);
    for (const element of [...old.eventProof.path, ...old.fundProof.path]) element.fill(0);
    const fresh = await proveEvent(tree, fundId, 1);
    expect(toHex(tree.root)).toBe(expectedRoot);
    expect(await verifyEventProof(fresh, tree.root)).toBe(true);
  });

  it("serializing a built tree cannot publish fund IDs or secret inputs", async () => {
    const tree = await buildIntervalTree([fund()]);
    expect(JSON.stringify(tree)).toBe("{}");
    expect(
      JSON.stringify({ root: toHex(tree.root), fundRoots: tree.fundRoots.map(toHex) }),
    ).not.toContain(fundId);
  });
});
