import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Hash32, hash32, salt32, toHex } from "./hash.js";
import { buildIntervalTree, proveEvent, verifyEventProof } from "./interval.js";
import { parseFundId } from "./proof.js";
import { leafHash, merkleRoot, proveInclusion, verifyInclusion } from "./tree.js";

const bytes = fc.uint8Array({ minLength: 32, maxLength: 32 });
const leavesArbitrary = fc.uniqueArray(bytes, { minLength: 1, maxLength: 33, selector: toHex });
const bitArbitrary = fc.integer({ min: 0, max: 255 });
const options = { numRuns: 75 };

function flip(bytes: Uint8Array, bit: number): Hash32 {
  return hash32(
    bytes.map((byte, i) => (i === Math.floor(bit / 8) ? byte ^ (1 << (bit % 8)) : byte)),
  );
}

describe("Merkle properties", () => {
  it("mutating any leaf changes the root", async () => {
    await fc.assert(
      fc.asyncProperty(leavesArbitrary, fc.nat(), bitArbitrary, async (raw, choice, bit) => {
        const leaves = raw.map(hash32);
        const index = choice % leaves.length;
        const changed = leaves.map((leaf, i) => (i === index ? flip(leaf, bit) : leaf));
        expect(toHex(await merkleRoot(changed))).not.toBe(toHex(await merkleRoot(leaves)));
      }),
      options,
    );
  });

  it("every valid proof verifies, including every index of non-power-of-two trees", async () => {
    await fc.assert(
      fc.asyncProperty(leavesArbitrary, async (raw) => {
        const leaves = raw.map(hash32);
        const root = await merkleRoot(leaves);
        for (const [index, leaf] of leaves.entries()) {
          expect(await verifyInclusion(await proveInclusion(leaves, index), leaf, root)).toBe(true);
        }
      }),
      options,
    );
  });

  it("single-bit tampering of each path element, index, leaf or root fails for distinct leaves", async () => {
    await fc.assert(
      fc.asyncProperty(
        leavesArbitrary,
        fc.nat(),
        bitArbitrary,
        fc.integer({ min: 0, max: 6 }),
        async (raw, choice, bit, positionBit) => {
          const leaves = raw.map(hash32);
          const index = choice % leaves.length;
          const leaf = leaves.at(index);
          if (leaf === undefined) throw new Error("Nonempty generated leaves");
          const root = await merkleRoot(leaves);
          const proof = await proveInclusion(leaves, index);
          for (const elementIndex of proof.path.keys()) {
            const path = proof.path.map((element, i) =>
              i === elementIndex ? flip(element, bit) : element,
            );
            expect(await verifyInclusion({ ...proof, path }, leaf, root)).toBe(false);
          }
          expect(
            await verifyInclusion({ ...proof, index: index ^ (1 << positionBit) }, leaf, root),
          ).toBe(false);
          expect(await verifyInclusion(proof, flip(leaf, bit), root)).toBe(false);
          expect(await verifyInclusion(proof, leaf, flip(root, bit))).toBe(false);
        },
      ),
      options,
    );
  });

  it("every single-bit size tamper fails for complete trees", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .integer({ min: 0, max: 5 })
          .chain((power) => fc.array(bytes, { minLength: 2 ** power, maxLength: 2 ** power })),
        fc.nat(),
        fc.integer({ min: 0, max: 8 }),
        async (raw, choice, bit) => {
          const leaves = raw.map(hash32);
          const index = choice % leaves.length;
          const leaf = leaves.at(index);
          if (leaf === undefined) throw new Error("Nonempty generated leaves");
          const proof = await proveInclusion(leaves, index);
          expect(
            await verifyInclusion(
              { ...proof, size: proof.size ^ (1 << bit) },
              leaf,
              await merkleRoot(leaves),
            ),
          ).toBe(false);
        },
      ),
      options,
    );
  });

  it("two-level proofs reject single-bit salt, event hash, latest hash and root tampering or another fund", async () => {
    const id = parseFundId("00000000-0000-0000-0000-000000000001");
    const otherId = parseFundId("00000000-0000-0000-0000-000000000002");
    if (!id.ok || !otherId.ok) throw new Error("Valid test UUIDs");
    await fc.assert(
      fc.asyncProperty(bytes, bytes, bitArbitrary, async (rawSalt, rawEvent, bit) => {
        const salt = salt32(rawSalt);
        const eventHash = hash32(rawEvent);
        const tree = await buildIntervalTree([
          { fundId: id.value, latestEventHash: eventHash, events: [{ seq: 1, salt, eventHash }] },
        ]);
        const bundle = await proveEvent(tree, id.value, 1);
        expect(await verifyEventProof(bundle, tree.root)).toBe(true);
        expect(
          await verifyEventProof({ ...bundle, salt: salt32(flip(salt, bit)) }, tree.root),
        ).toBe(false);
        expect(
          await verifyEventProof({ ...bundle, eventHash: flip(eventHash, bit) }, tree.root),
        ).toBe(false);
        expect(
          await verifyEventProof({ ...bundle, latestEventHash: flip(eventHash, bit) }, tree.root),
        ).toBe(false);
        expect(await verifyEventProof({ ...bundle, fundId: otherId.value }, tree.root)).toBe(false);
        expect(await verifyEventProof(bundle, flip(tree.root, bit))).toBe(false);
        const leaf = await leafHash(salt, eventHash);
        expect(toHex(await leafHash(salt32(flip(salt, bit)), eventHash))).not.toBe(toHex(leaf));
      }),
      options,
    );
  });

  it("swapping salts or event hashes between distinct events fails", async () => {
    const id = parseFundId("00000000-0000-0000-0000-000000000001");
    if (!id.ok) throw new Error("Valid test UUID");
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(bytes, bytes, bytes, bytes)
          .filter(([s1, s2, h1, h2]) => toHex(s1) !== toHex(s2) && toHex(h1) !== toHex(h2)),
        async ([s1, s2, h1, h2]) => {
          const first = { seq: 1, salt: salt32(s1), eventHash: hash32(h1) };
          const second = { seq: 2, salt: salt32(s2), eventHash: hash32(h2) };
          const tree = await buildIntervalTree([
            { fundId: id.value, latestEventHash: second.eventHash, events: [second, first] },
          ]);
          const a = await proveEvent(tree, id.value, 1);
          const b = await proveEvent(tree, id.value, 2);
          expect(await verifyEventProof({ ...a, salt: b.salt }, tree.root)).toBe(false);
          expect(await verifyEventProof({ ...b, salt: a.salt }, tree.root)).toBe(false);
          expect(await verifyEventProof({ ...a, eventHash: b.eventHash }, tree.root)).toBe(false);
          expect(await verifyEventProof({ ...b, eventHash: a.eventHash }, tree.root)).toBe(false);
        },
      ),
      options,
    );
  });

  it("every event verifies across generated intervals with shuffled funds, events and idle funds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(fc.record({ salt: bytes, eventHash: bytes }), { maxLength: 7 }), {
          maxLength: 5,
        }),
        async (rawFunds) => {
          const funds = rawFunds
            .map((rawEvents, index) => {
              const id = parseFundId(
                `00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`,
              );
              if (!id.ok) throw new Error(id.error);
              const events = rawEvents.map((raw, index) => ({
                seq: index * 2,
                salt: salt32(raw.salt),
                eventHash: hash32(raw.eventHash),
              }));
              return {
                fundId: id.value,
                latestEventHash: events.at(-1)?.eventHash ?? hash32(new Uint8Array(32)),
                events: events.toReversed(),
              };
            })
            .toReversed();
          const tree = await buildIntervalTree(funds);
          for (const fund of funds) {
            for (const event of fund.events) {
              expect(
                await verifyEventProof(await proveEvent(tree, fund.fundId, event.seq), tree.root),
              ).toBe(true);
            }
          }
        },
      ),
      options,
    );
  });
});
