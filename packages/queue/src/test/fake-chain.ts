import type { ChainReceipt, Publication, RootChain } from "../anchoring.js";

export class FakeChain implements RootChain {
  readonly chainId = 80002n;
  readonly roots = new Map<bigint, string>();
  readonly receipts = new Map<string, ChainReceipt>();
  readonly publications = new Map<bigint, Publication>();
  publishCount = 0;
  crashAfterFirstBroadcast = false;
  failNext = false;
  blockNumber = 100n;
  balance = 1_000_000_000_000_000_000n;
  async getRoot(sequence: bigint): Promise<string> {
    return this.roots.get(sequence) ?? `0x${"0".repeat(64)}`;
  }
  async getReceipt(hash: string): Promise<ChainReceipt | null> {
    return this.receipts.get(hash) ?? null;
  }
  async getPublication(sequence: bigint): Promise<Publication | null> {
    return this.publications.get(sequence) ?? null;
  }
  async getBlockNumber(): Promise<bigint> {
    return this.blockNumber;
  }
  async getLatestSequence(): Promise<bigint> {
    return [...this.roots.keys()].reduce(
      (latest, sequence) => (sequence > latest ? sequence : latest),
      0n,
    );
  }
  async getBalance(): Promise<bigint> {
    return this.balance;
  }
  async publish(root: `0x${string}`, sequence: bigint): Promise<string> {
    this.publishCount += 1;
    const hash = `0x${this.publishCount.toString(16).padStart(64, "0")}`;
    if (this.failNext) {
      this.failNext = false;
      this.receipts.set(hash, { status: "failed" });
      return hash;
    }
    this.roots.set(sequence, root);
    this.publications.set(sequence, { txHash: hash, blockNumber: 100n });
    this.receipts.set(hash, { status: "success", blockNumber: 100n });
    if (this.crashAfterFirstBroadcast) {
      this.crashAfterFirstBroadcast = false;
      throw new Error("simulated process kill after broadcast");
    }
    return hash;
  }
  async replacePending(hash: string): Promise<string> {
    return hash;
  }
}
