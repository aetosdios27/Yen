import { equalBytes, type Hash32, hash32, type Salt32, sha256 } from "./hash.js";

const leafPrefix = Uint8Array.of(0x00);
const nodePrefix = Uint8Array.of(0x01);

export type InclusionProof = {
  readonly index: number;
  readonly size: number;
  readonly path: readonly Hash32[];
};

export function leafHash(salt: Salt32, eventHash: Hash32): Promise<Hash32> {
  return sha256(leafPrefix, salt, eventHash);
}

function nodeHash(left: Hash32, right: Hash32): Promise<Hash32> {
  return sha256(nodePrefix, left, right);
}

function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export async function merkleRoot(leaves: readonly Hash32[]): Promise<Hash32> {
  const [first] = leaves;
  if (first === undefined) return sha256();
  if (leaves.length === 1) return hash32(first);
  const k = largestPowerOfTwoBelow(leaves.length);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

async function auditPath(index: number, leaves: readonly Hash32[]): Promise<Hash32[]> {
  if (leaves.length <= 1) return [];
  const k = largestPowerOfTwoBelow(leaves.length);
  return index < k
    ? [...(await auditPath(index, leaves.slice(0, k))), await merkleRoot(leaves.slice(k))]
    : [...(await auditPath(index - k, leaves.slice(k))), await merkleRoot(leaves.slice(0, k))];
}

export async function proveInclusion(
  leaves: readonly Hash32[],
  index: number,
): Promise<InclusionProof> {
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`Index ${index} is outside a tree of ${leaves.length} leaves`);
  }
  return { index, size: leaves.length, path: (await auditPath(index, leaves)).map(hash32) };
}

// Division preserves exact sizes above 2^31; JavaScript bit shifts truncate to 32 bits.
export async function rootFromInclusion(
  proof: InclusionProof,
  leaf: Hash32,
): Promise<Hash32 | undefined> {
  const { index, size, path } = proof;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size) {
    return undefined;
  }
  let fn = index;
  let sn = size - 1;
  let root = leaf;
  for (const sibling of path) {
    if (sn === 0) return undefined;
    if (fn % 2 === 1 || fn === sn) {
      root = await nodeHash(sibling, root);
      while (fn % 2 === 0 && fn !== 0) {
        fn /= 2;
        sn = Math.floor(sn / 2);
      }
    } else {
      root = await nodeHash(root, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 ? root : undefined;
}

export async function verifyInclusion(
  proof: InclusionProof,
  leaf: Hash32,
  root: Hash32,
): Promise<boolean> {
  const computed = await rootFromInclusion(proof, leaf);
  return computed !== undefined && equalBytes(computed, root);
}
