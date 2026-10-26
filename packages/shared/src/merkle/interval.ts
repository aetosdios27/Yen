import { equalBytes, fromHex, type Hash32, hash32, type Salt32, salt32, sha256 } from "./hash.js";
import { createEventProof, type EventProof, type FundId } from "./proof.js";
import { leafHash, merkleRoot, proveInclusion, rootFromInclusion } from "./tree.js";

export type IntervalEvent = {
  readonly seq: number;
  readonly salt: Salt32;
  readonly eventHash: Hash32;
};

export type IntervalFund = {
  readonly fundId: FundId;
  readonly latestEventHash: Hash32;
  readonly events: readonly IntervalEvent[];
};

type FundTree = IntervalFund & { readonly root: Hash32; readonly leaves: readonly Hash32[] };

export function fingerprint(fundId: FundId, latestEventHash: Hash32): Promise<Hash32> {
  return sha256(Uint8Array.of(0x03), fromHex(fundId.replaceAll("-", "")), latestEventHash);
}

function u64be(count: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(count), false);
  return bytes;
}

function fundLeaf(eventCount: number, root: Hash32, identity: Hash32): Promise<Hash32> {
  return sha256(Uint8Array.of(0x02), u64be(eventCount), root, identity);
}

function globalRoot(fundCount: number, root: Hash32): Promise<Hash32> {
  return sha256(Uint8Array.of(0x04), u64be(fundCount), root);
}

class IntervalTree {
  readonly #funds;
  readonly #leaves;
  readonly #root;

  constructor(funds: readonly FundTree[], leaves: readonly Hash32[], root: Hash32) {
    this.#funds = funds;
    this.#leaves = leaves;
    this.#root = root;
  }

  get root(): Hash32 {
    return hash32(this.#root);
  }

  get fundRoots(): readonly Hash32[] {
    return this.#funds.map((fund) => hash32(fund.root));
  }

  async prove(fundId: FundId, seq: number): Promise<EventProof> {
    const fundIndex = this.#funds.findIndex((fund) => fund.fundId === fundId);
    const fund = this.#funds[fundIndex];
    if (fund === undefined) throw new RangeError("Fund is outside this interval tree");
    const eventIndex = fund.events.findIndex((event) => event.seq === seq);
    const event = fund.events[eventIndex];
    if (event === undefined) throw new RangeError("Event is outside this fund's interval tree");
    return createEventProof({
      format: "yen/event-proof/v1",
      salt: salt32(event.salt),
      eventHash: hash32(event.eventHash),
      eventProof: await proveInclusion(fund.leaves, eventIndex),
      fundId,
      latestEventHash: hash32(fund.latestEventHash),
      fundProof: await proveInclusion(this.#leaves, fundIndex),
    });
  }
}

export type { IntervalTree };

export async function buildIntervalTree(funds: readonly IntervalFund[]): Promise<IntervalTree> {
  // Canonical UUID strings have identical byte and lexicographic order (hyphens are fixed).
  const ordered = funds
    .map((fund) => ({
      fundId: fund.fundId,
      latestEventHash: hash32(fund.latestEventHash),
      events: fund.events
        .map((event) => ({
          seq: event.seq,
          salt: salt32(event.salt),
          eventHash: hash32(event.eventHash),
        }))
        .sort((a, b) => a.seq - b.seq),
    }))
    .sort((a, b) => (a.fundId < b.fundId ? -1 : a.fundId > b.fundId ? 1 : 0));
  const seen = new Set<FundId>();
  for (const fund of ordered) {
    if (seen.has(fund.fundId)) throw new RangeError("Duplicate fund ID");
    seen.add(fund.fundId);
    let previous = -1;
    for (const event of fund.events) {
      if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq === previous) {
        throw new RangeError("Event sequences must be distinct nonnegative safe integers");
      }
      previous = event.seq;
    }
    const latest = fund.events.at(-1);
    if (latest !== undefined && !equalBytes(latest.eventHash, fund.latestEventHash)) {
      throw new RangeError("Latest event hash must match the last event in sequence order");
    }
  }
  const trees: FundTree[] = [];
  const leaves: Hash32[] = [];
  for (const fund of ordered) {
    const eventLeaves = await Promise.all(
      fund.events.map((event) => leafHash(event.salt, event.eventHash)),
    );
    const root = await merkleRoot(eventLeaves);
    trees.push({ ...fund, root, leaves: eventLeaves });
    leaves.push(
      await fundLeaf(
        eventLeaves.length,
        root,
        await fingerprint(fund.fundId, fund.latestEventHash),
      ),
    );
  }
  return new IntervalTree(trees, leaves, await globalRoot(leaves.length, await merkleRoot(leaves)));
}

export function proveEvent(tree: IntervalTree, fundId: FundId, seq: number): Promise<EventProof> {
  return tree.prove(fundId, seq);
}

export async function verifyEventProof(
  bundle: EventProof,
  expectedGlobalRoot: Hash32,
): Promise<boolean> {
  const root = await rootFromInclusion(
    bundle.eventProof,
    await leafHash(bundle.salt, bundle.eventHash),
  );
  if (root === undefined) return false;
  const leaf = await fundLeaf(
    bundle.eventProof.size,
    root,
    await fingerprint(bundle.fundId, bundle.latestEventHash),
  );
  const intervalRoot = await rootFromInclusion(bundle.fundProof, leaf);
  return (
    intervalRoot !== undefined &&
    equalBytes(await globalRoot(bundle.fundProof.size, intervalRoot), expectedGlobalRoot)
  );
}
