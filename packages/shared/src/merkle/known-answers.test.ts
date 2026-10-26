import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromHex, type Hash32, hash32, salt32, toHex } from "./hash.js";
import { leafHash, merkleRoot, proveInclusion, verifyInclusion } from "./tree.js";

type ProofVector = { index: number; path: string[] };
type Vectors = {
  leaves: { salt: string; eventHash: string; leaf: string }[];
  trees: { size: number; root: string; proofs: ProofVector[] }[];
};

const vectors: Vectors = JSON.parse(
  readFileSync(new URL("../../test-vectors/merkle.json", import.meta.url), "utf8"),
);

const h = (hex: string): Hash32 => hash32(fromHex(hex));
const leafHashes = vectors.leaves.map((v) => h(v.leaf));

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
