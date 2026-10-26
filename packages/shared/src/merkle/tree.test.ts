import { describe, expect, it } from "vitest";
import { hash32, salt32, sha256, toHex } from "./hash.js";
import { leafHash, merkleRoot, proveInclusion, verifyInclusion } from "./tree.js";

const leaves = Array.from({ length: 7 }, (_, i) => hash32(new Uint8Array(32).fill(i + 1)));

describe("RFC inclusion edge cases and limits", () => {
  it("empty trees have the empty SHA-256 root and cannot produce a proof", async () => {
    expect(toHex(await merkleRoot([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(proveInclusion([], 0)).rejects.toThrow(RangeError);
    const leaf = hash32(new Uint8Array(32));
    expect(await verifyInclusion({ index: 0, size: 0, path: [] }, leaf, leaf)).toBe(false);
  });

  it("one leaf has an empty proof and returning the root does not expose its input", async () => {
    const leaf = hash32(new Uint8Array(32).fill(1));
    const root = await merkleRoot([leaf]);
    const proof = await proveInclusion([leaf], 0);
    expect(proof).toEqual({ index: 0, size: 1, path: [] });
    expect(await verifyInclusion(proof, leaf, root)).toBe(true);
    root.fill(0);
    expect(leaf[0]).toBe(1);
  });

  it.each([-1, 7, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid index %s",
    async (index) => {
      await expect(proveInclusion(leaves, index)).rejects.toThrow(RangeError);
    },
  );

  it("rejects missing and extra path elements and invalid metadata", async () => {
    for (const [index, leaf] of leaves.entries()) {
      const proof = await proveInclusion(leaves, index);
      const root = await merkleRoot(leaves);
      expect(await verifyInclusion({ ...proof, path: proof.path.slice(1) }, leaf, root)).toBe(
        false,
      );
      expect(await verifyInclusion({ ...proof, path: [...proof.path, leaf] }, leaf, root)).toBe(
        false,
      );
      for (const invalid of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(await verifyInclusion({ ...proof, size: invalid }, leaf, root)).toBe(false);
      }
    }
  });

  it("duplicate leaves prove occupied positions but cannot forge inclusion at an absent position", async () => {
    const leaf = hash32(new Uint8Array(32).fill(9));
    const root = await merkleRoot([leaf, leaf]);
    const proof = await proveInclusion([leaf, leaf], 0);
    expect(await verifyInclusion(proof, leaf, root)).toBe(true);
    expect(await verifyInclusion({ ...proof, index: 1 }, leaf, root)).toBe(true);
    expect(await verifyInclusion({ ...proof, index: 2 }, leaf, root)).toBe(false);
    expect(await verifyInclusion(proof, hash32(new Uint8Array(32)), root)).toBe(false);
  });

  it("some single-bit size changes preserve the RFC path: size must be authenticated separately", async () => {
    const subset = leaves.slice(0, 5);
    const leaf = subset.at(0);
    if (leaf === undefined) throw new Error("Fixture leaf");
    const proof = await proveInclusion(subset, 0);
    expect(await verifyInclusion({ ...proof, size: 5 ^ 2 }, leaf, await merkleRoot(subset))).toBe(
      true,
    );
  });

  it("domain separation rejects an internal node's children reinterpreted as salt and event hash", async () => {
    const left = hash32(new Uint8Array(32).fill(1));
    const right = hash32(new Uint8Array(32).fill(2));
    const internal = await sha256(Uint8Array.of(0x01), left, right);
    const forged = await leafHash(salt32(left), right);
    expect(toHex(forged)).not.toBe(toHex(internal));
    expect(await verifyInclusion({ index: 0, size: 1, path: [] }, forged, internal)).toBe(false);
  });

  it("proof elements do not share mutable bytes with input leaves", async () => {
    const left = hash32(new Uint8Array(32).fill(1));
    const right = hash32(new Uint8Array(32).fill(2));
    const proof = await proveInclusion([left, right], 0);
    for (const sibling of proof.path) sibling.fill(0);
    expect(right[0]).toBe(2);
  });

  it("verifies the final singleton above 2^32 without truncating index or size", async () => {
    const leaf = hash32(new Uint8Array(32).fill(1));
    const sibling = hash32(new Uint8Array(32).fill(2));
    const root = await sha256(Uint8Array.of(0x01), sibling, leaf);
    expect(
      await verifyInclusion({ index: 2 ** 32, size: 2 ** 32 + 1, path: [sibling] }, leaf, root),
    ).toBe(true);
  });
});
