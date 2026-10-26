import { describe, expect, it } from "vitest";
import vectors from "../../test-vectors/merkle.json" with { type: "json" };
import { fromHex, type Hash32, hash32, salt32, toHex } from "./hash.js";
import { buildIntervalTree, fingerprint, proveEvent, verifyEventProof } from "./interval.js";
import { parseEventProof, parseFundId, type Result, serializeEventProof } from "./proof.js";
import { leafHash, merkleRoot, proveInclusion, verifyInclusion } from "./tree.js";

const h = (hex: string): Hash32 => hash32(fromHex(hex));
const leafHashes = vectors.leaves.map((v) => h(v.leaf));

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("known answers from the independent Python implementation", () => {
  it("event leaves are SHA256(0x00 || salt || eventHash)", async () => {
    for (const v of vectors.leaves) {
      expect(toHex(await leafHash(salt32(fromHex(v.salt)), h(v.eventHash)))).toBe(v.leaf);
    }
  });

  it.each(vectors.trees.map((t) => [t.size, t] as const))("root of %i leaves", async (_, tree) => {
    expect(toHex(await merkleRoot(leafHashes.slice(0, tree.size)))).toBe(tree.root);
  });

  it.each(vectors.trees.filter((t) => t.proofs.length > 0).map((t) => [t.size, t] as const))(
    "inclusion proofs in a tree of %i leaves",
    async (_, tree) => {
      const leaves = leafHashes.slice(0, tree.size);
      for (const expected of tree.proofs) {
        const proof = await proveInclusion(leaves, expected.index);
        expect({ index: proof.index, size: proof.size, path: proof.path.map(toHex) }).toEqual({
          index: expected.index,
          size: tree.size,
          path: expected.path,
        });
        const fromVector = { index: expected.index, size: tree.size, path: expected.path.map(h) };
        const leaf = leaves[expected.index];
        expect(leaf && (await verifyInclusion(fromVector, leaf, h(tree.root)))).toBe(true);
      }
    },
  );

  it("covers every index of trees with 1 to 17 leaves", () => {
    for (let size = 1; size <= 17; size++) {
      const tree = vectors.trees.find((t) => t.size === size);
      expect(tree?.proofs.map((p) => p.index)).toEqual([...Array(size).keys()]);
    }
  });
});

describe("nested known answers from the independent Python implementation", () => {
  it("fingerprints bind UUID bytes and latest event hash with prefix 0x03", async () => {
    for (const vector of vectors.fingerprints) {
      expect(
        toHex(await fingerprint(unwrap(parseFundId(vector.fundId)), h(vector.latestEventHash))),
      ).toBe(vector.fingerprint);
    }
  });

  it.each(vectors.intervals)(
    "$name: fund roots, global root and every event proof",
    async (vector) => {
      const funds = vector.funds.map((fund) => ({
        fundId: unwrap(parseFundId(fund.fundId)),
        latestEventHash: h(fund.latestEventHash),
        events: fund.events.map((event) => ({
          seq: event.seq,
          salt: salt32(fromHex(event.salt)),
          eventHash: h(event.eventHash),
        })),
      }));
      const tree = await buildIntervalTree(funds);
      expect(toHex(tree.root)).toBe(vector.root);
      const ordered = vector.funds.toSorted((a, b) =>
        a.fundId < b.fundId ? -1 : a.fundId > b.fundId ? 1 : 0,
      );
      expect(tree.fundRoots.map(toHex)).toEqual(ordered.map((fund) => fund.fundRoot));
      expect(toHex(await merkleRoot(ordered.map((fund) => h(fund.fundLeaf))))).toBe(vector.root);
      for (const expected of vector.proofs) {
        const bundle = unwrap(parseEventProof(expected));
        expect(await verifyEventProof(bundle, h(vector.root))).toBe(true);
        const generated = await proveEvent(tree, bundle.fundId, 10 + bundle.eventProof.index * 3);
        expect(JSON.parse(serializeEventProof(generated))).toEqual(expected);
        expect(await verifyEventProof(generated, tree.root)).toBe(true);
      }
    },
  );
});
