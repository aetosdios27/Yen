import { randomBytes, randomUUID } from "node:crypto";
import { createSql, type Sql } from "@yen/db";
import {
  buildIntervalTree,
  hash32,
  parseFundId,
  type ResilienceOptions,
  ResilientCall,
  salt32,
  toHex,
} from "@yen/shared";
import type { PgBoss } from "pg-boss";
import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";

export type RootSigner = { getAccount(): Promise<Account> };
export class LocalDevRootSigner implements RootSigner {
  private readonly account: PrivateKeyAccount;
  constructor(privateKey: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey))
      throw new Error("ANCHOR_PRIVATE_KEY must be a 32-byte hex key");
    this.account = privateKeyToAccount(privateKey as Hex);
  }
  async getAccount(): Promise<Account> {
    return this.account;
  }
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): LocalDevRootSigner {
    const key = env.ANCHOR_PRIVATE_KEY;
    if (!key) throw new Error("ANCHOR_PRIVATE_KEY is required for local development signing");
    return new LocalDevRootSigner(key);
  }
}

/** KMS adapter stub. It deliberately cannot sign until a provider implementation is configured. */
export class KmsRootSigner implements RootSigner {
  async getAccount(): Promise<Account> {
    throw new Error("KMS signer is not configured; refusing to sign");
  }
}

export type ChainReceipt = { status: "success" | "failed" | "pending"; blockNumber?: bigint };
export type Publication = { txHash: string; blockNumber: bigint };
export type RootChain = {
  getRoot(sequence: bigint): Promise<string>;
  getReceipt(hash: string): Promise<ChainReceipt | null>;
  getPublication(sequence: bigint): Promise<Publication | null>;
  getBlockNumber(): Promise<bigint>;
  publish(root: `0x${string}`, sequence: bigint, signer: RootSigner): Promise<string>;
  getLatestSequence(): Promise<bigint>;
  chainId: bigint;
};

export type AnchoringAlert = { dependency: "chain-rpc"; fundId: string; message: string };
export type AnchoringAlertSink = (alert: AnchoringAlert) => void | Promise<void>;

const chainRpcPolicy: ResilienceOptions = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  failureThreshold: 3,
  resetAfterMs: 30_000,
};

type AnchorRow = {
  id: string;
  fund_id: string;
  from_seq: bigint;
  to_seq: bigint;
  root: string;
  status: string;
  tx_hash: string | null;
  chain_id: bigint;
  chain_sequence: bigint;
};
type EventRow = { seq: bigint; hash: string };

export class AnchoringWorker {
  private readonly resilience: ResilientCall;
  constructor(
    private readonly sql: Sql,
    private readonly chain: RootChain,
    private readonly signer: RootSigner,
    private readonly alertSink: AnchoringAlertSink = (alert) => {
      process.stderr.write(
        `${JSON.stringify({ event: "outbound_dependency_failure", ...alert })}\n`,
      );
    },
    resilience: ResilienceOptions = chainRpcPolicy,
  ) {
    this.resilience = new ResilientCall(resilience);
  }

  private async chainCall<T>(
    fundId: string,
    operation: () => Promise<T>,
    runOptions?: { maxAttempts?: number },
  ): Promise<T> {
    try {
      return await this.resilience.run(operation, runOptions);
    } catch (error) {
      await this.alertSink({
        dependency: "chain-rpc",
        fundId,
        message: error instanceof Error ? error.message : "Chain RPC unavailable",
      });
      throw error;
    }
  }

  async runFund(fundId: string): Promise<void> {
    const parsed = parseFundId(fundId);
    if (!parsed.ok) throw new Error("Invalid fund ID");
    const fund = parsed.value;
    const anchor = await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(yen_fund_lock_key(${fund}::uuid))`;
      const latest = await tx<
        AnchorRow[]
      >`SELECT * FROM anchors WHERE fund_id = ${fund} ORDER BY to_seq DESC LIMIT 1 FOR UPDATE`;
      const lastAnchor = latest[0];
      if (lastAnchor && lastAnchor.status !== "confirmed") return lastAnchor;
      const start = (lastAnchor?.to_seq ?? 0n) + 1n;
      const rows = await tx<
        EventRow[]
      >`SELECT seq, hash FROM fund_events WHERE fund_id = ${fund} AND seq >= ${start} ORDER BY seq`;
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const lastRow = rows.at(-1);
      if (!firstRow || !lastRow) return null;
      const from = firstRow.seq;
      const to = lastRow.seq;
      const existing = await tx<
        AnchorRow[]
      >`SELECT * FROM anchors WHERE fund_id = ${fund} AND from_seq = ${from} AND to_seq = ${to} FOR UPDATE`;
      let anchor = existing[0];
      if (!anchor) {
        const events = rows.map((row) => ({
          seq: Number(row.seq),
          eventHash: hash32(Uint8Array.from(Buffer.from(row.hash, "hex"))),
          salt: salt32(randomBytes(32)),
        }));
        const lastEvent = events.at(-1);
        if (!lastEvent) throw new Error("Cannot build an anchor without events");
        const tree = await buildIntervalTree([
          { fundId: fund, latestEventHash: lastEvent.eventHash, events },
        ]);
        const root = toHex(tree.root);
        await tx`SELECT pg_advisory_xact_lock(802412987)`;
        const seqRows = await tx<
          { next_sequence: bigint }[]
        >`SELECT COALESCE(MAX(chain_sequence), 0) + 1 AS next_sequence FROM anchors`;
        const databaseSequence = seqRows[0]?.next_sequence;
        if (databaseSequence === undefined)
          throw new Error("Could not allocate an anchor sequence");
        const chainSequence =
          (await this.chainCall(fund, () => this.chain.getLatestSequence())) + 1n;
        const nextSequence = databaseSequence > chainSequence ? databaseSequence : chainSequence;
        const inserted = await tx<
          AnchorRow[]
        >`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, chain_id, chain_sequence) VALUES (${randomUUID()}, ${fund}, ${from}, ${to}, ${root}, ${this.chain.chainId}, ${nextSequence}) RETURNING *`;
        const insertedAnchor = inserted[0];
        if (!insertedAnchor) throw new Error("Anchor insert returned no row");
        anchor = insertedAnchor;
        const saltRows = events.map((event, index) => {
          const row = rows[index];
          if (!row) throw new Error("Anchor event range changed while building salts");
          return {
            anchor_id: insertedAnchor.id,
            fund_id: fund,
            seq: row.seq,
            salt: toHex(event.salt),
          };
        });
        await tx`INSERT INTO anchor_event_salts ${tx(saltRows)}`;
      }
      // Submissions occur after persistence, so retries always find the durable anchor first.
      return anchor;
    });
    if (anchor) await this.submit(anchor);
  }

  async submit(anchor: AnchorRow): Promise<void> {
    const sequence = BigInt(anchor.chain_sequence);
    if (anchor.status === "confirmed") return;
    if (anchor.status === "submitted" && anchor.tx_hash) {
      const txHash = anchor.tx_hash;
      const receipt = await this.chainCall(anchor.fund_id, () => this.chain.getReceipt(txHash));
      if (receipt?.status === "success" && receipt.blockNumber !== undefined) {
        if (
          (await this.chainCall(anchor.fund_id, () => this.chain.getBlockNumber())) -
            receipt.blockNumber +
            1n >=
          12n
        )
          await this.sql`UPDATE anchors SET status = 'confirmed' WHERE id = ${anchor.id}`;
        return;
      }
      if (receipt?.status === "pending" || receipt === null) return;
      if (receipt.status === "failed") {
        await this.sql`UPDATE anchors SET status = 'failed' WHERE id = ${anchor.id}`;
        throw new Error("Anchor transaction failed; pg-boss will retry with exponential backoff");
      }
    }
    const published = await this.chainCall(anchor.fund_id, () => this.chain.getRoot(sequence));
    if (published.toLowerCase() === `0x${anchor.root}`.toLowerCase()) {
      const publication = await this.chainCall(anchor.fund_id, () =>
        this.chain.getPublication(sequence),
      );
      if (!publication)
        throw new Error("Root is present but its publication receipt is not yet available");
      await this
        .sql`UPDATE anchors SET status = 'submitted', tx_hash = ${publication.txHash} WHERE id = ${anchor.id}`;
      if (
        (await this.chainCall(anchor.fund_id, () => this.chain.getBlockNumber())) -
          publication.blockNumber +
          1n >=
        12n
      )
        await this.sql`UPDATE anchors SET status = 'confirmed' WHERE id = ${anchor.id}`;
      return;
    }
    const latestSequence = await this.chainCall(anchor.fund_id, () =>
      this.chain.getLatestSequence(),
    );
    if (sequence <= latestSequence) {
      throw new Error("Anchor sequence is already occupied by a different on-chain root");
    }
    const hash = await this.chainCall(
      anchor.fund_id,
      () => this.chain.publish(`0x${anchor.root}`, sequence, this.signer),
      { maxAttempts: 1 },
    );
    await this
      .sql`UPDATE anchors SET status = 'submitted', tx_hash = ${hash} WHERE id = ${anchor.id}`;
  }
}

const publishRootAbi = [
  {
    type: "function",
    name: "publishRoot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "sequence", type: "uint64" },
    ],
    outputs: [],
  },
] as const;
const rootAtAbi = [
  {
    type: "function",
    name: "rootAt",
    stateMutability: "view",
    inputs: [{ name: "sequence", type: "uint64" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "latestSequence",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export class ViemRootChain implements RootChain {
  readonly chainId: bigint;
  private readonly publicClient;
  private readonly rpcUrl: string;
  constructor(
    rpcUrl: string,
    private readonly address: `0x${string}`,
    chain: Chain = polygonAmoy,
  ) {
    this.chainId = BigInt(chain.id);
    this.rpcUrl = rpcUrl;
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  }
  async getRoot(sequence: bigint): Promise<string> {
    return this.publicClient.readContract({
      address: this.address,
      abi: rootAtAbi,
      functionName: "rootAt",
      args: [sequence],
    });
  }
  async getLatestSequence(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: rootAtAbi,
      functionName: "latestSequence",
    });
  }
  async getBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }
  async getPublication(sequence: bigint): Promise<Publication | null> {
    const logs = await this.publicClient.getLogs({
      address: this.address,
      event: {
        type: "event",
        name: "RootPublished",
        inputs: [
          { name: "sequence", type: "uint64", indexed: true },
          { name: "root", type: "bytes32", indexed: true },
          { name: "publisher", type: "address", indexed: true },
        ],
      },
      args: { sequence },
      fromBlock: "earliest",
    });
    const log = logs.at(-1);
    return log ? { txHash: log.transactionHash, blockNumber: log.blockNumber } : null;
  }
  async getReceipt(hash: string): Promise<ChainReceipt | null> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: hash as Hex });
      return {
        status: receipt.status === "success" ? "success" : "failed",
        blockNumber: receipt.blockNumber,
      };
    } catch {
      try {
        await this.publicClient.getTransaction({ hash: hash as Hex });
        return { status: "pending" };
      } catch {
        return null;
      }
    }
  }
  async publish(root: `0x${string}`, sequence: bigint, signer: RootSigner): Promise<string> {
    const account = await signer.getAccount();
    const wallet = createWalletClient({
      account,
      chain: this.publicClient.chain,
      transport: http(this.rpcUrl),
    });
    return wallet.writeContract({
      address: this.address,
      abi: publishRootAbi,
      functionName: "publishRoot",
      args: [root, sequence],
    });
  }
}

export async function registerAnchoringDiscovery(boss: PgBoss, sql: Sql): Promise<void> {
  await boss.createQueue("blockchain-anchoring-discovery");
  await boss.work<Record<string, never>>(
    "blockchain-anchoring-discovery",
    { batchSize: 1 },
    async () => {
      const funds = await sql<{ id: string }[]>`
        SELECT id FROM funds WHERE status = 'active' ORDER BY id
      `;
      for (const fund of funds)
        await boss.send(
          "blockchain-anchoring",
          { fundId: fund.id },
          { singletonKey: `fund:${fund.id}` },
        );
    },
  );
  await boss.schedule("blockchain-anchoring-discovery", "*/5 * * * *", {});
}

export function createAnchoringWorker(
  connectionString: string,
  chain: RootChain,
  signer: RootSigner,
  alertSink?: AnchoringAlertSink,
  resilience?: ResilienceOptions,
): AnchoringWorker {
  return new AnchoringWorker(createSql(connectionString), chain, signer, alertSink, resilience);
}
