import { createPublicKey, randomBytes, randomUUID } from "node:crypto";
import {
  GetPublicKeyCommand,
  KMSClient,
  type KMSClientConfig,
  SignCommand,
} from "@aws-sdk/client-kms";
import { createSql, type Sql } from "@yen/db";
import { buildIntervalTree, hash32, parseFundId, salt32, toHex } from "@yen/shared";
import type { PgBoss } from "pg-boss";
import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  hashMessage,
  hashTypedData,
  http,
  keccak256,
  recoverAddress,
  serializeTransaction,
  toHex as viemToHex,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount, toAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import { publicKeyToAddress } from "viem/utils";

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

const SECP256K1_ORDER = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);
const HALF_SECP256K1_ORDER = SECP256K1_ORDER / 2n;
const MAX_FEE_PER_GAS = 100_000_000_000n;
const INITIAL_MAX_FEE_PER_GAS = 50_000_000_000n;
const PRIORITY_FEE_PER_GAS = 1_000_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 2_000_000_000n;
export function parseDerEcdsaSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  const byte = () => {
    const value = der[i++];
    if (value === undefined) throw new Error("Malformed KMS DER signature");
    return value;
  };
  if (byte() !== 0x30) throw new Error("Malformed KMS DER signature");
  const sequenceLength = byte();
  if (sequenceLength & 0x80) throw new Error("Unsupported KMS DER signature length");
  const integer = () => {
    if (byte() !== 0x02) throw new Error("Malformed KMS DER signature");
    const length = byte();
    if (!length || length > 33) throw new Error("Malformed KMS DER integer");
    const value = der.slice(i, i + length);
    i += length;
    if (value.length !== length || value[0] === undefined || value[0] & 0x80)
      throw new Error("Malformed KMS DER integer");
    return BigInt(`0x${Buffer.from(value).toString("hex")}`);
  };
  const r = integer();
  let s = integer();
  if (
    i !== der.length ||
    i !== sequenceLength + 2 ||
    r <= 0n ||
    r >= SECP256K1_ORDER ||
    s <= 0n ||
    s >= SECP256K1_ORDER
  )
    throw new Error("Invalid KMS secp256k1 signature");
  if (s > HALF_SECP256K1_ORDER) s = SECP256K1_ORDER - s;
  return { r, s };
}

export class KmsRootSigner implements RootSigner {
  private readonly client: KMSClient;
  private account?: Account;
  constructor(
    private readonly keyId = process.env.ANCHOR_KMS_KEY_ID,
    config: KMSClientConfig = {},
    client?: KMSClient,
  ) {
    this.client = client ?? new KMSClient(config);
  }
  async getAccount(): Promise<Account> {
    if (!this.keyId) throw new Error("ANCHOR_KMS_KEY_ID is required for KMS signing");
    if (this.account) return this.account;
    const publicKeyResponse = await this.client.send(
      new GetPublicKeyCommand({ KeyId: this.keyId }),
    );
    if (
      publicKeyResponse.SigningAlgorithms?.includes("ECDSA_SHA_256") !== true ||
      !publicKeyResponse.PublicKey
    )
      throw new Error("KMS key must be an ECC_SECG_P256K1 signing key");
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyResponse.PublicKey),
      format: "der",
      type: "spki",
    }).export({ format: "jwk" });
    if (!publicKey.x || !publicKey.y || publicKey.crv !== "secp256k1")
      throw new Error("KMS public key is not secp256k1");
    const address = publicKeyToAddress(
      `0x04${Buffer.from(publicKey.x, "base64url").toString("hex")}${Buffer.from(publicKey.y, "base64url").toString("hex")}` as Hex,
    );
    const signDigest = async (hash: Hex) => {
      const response = await this.client.send(
        new SignCommand({
          KeyId: this.keyId,
          Message: Buffer.from(hash.slice(2), "hex"),
          MessageType: "DIGEST",
          SigningAlgorithm: "ECDSA_SHA_256",
        }),
      );
      if (!response.Signature) throw new Error("KMS returned no signature");
      const { r, s } = parseDerEcdsaSignature(response.Signature);
      const signature = `${viemToHex(r, { size: 32 }).slice(2)}${viemToHex(s, { size: 32 }).slice(2)}`;
      let yParity: 0 | 1 | undefined;
      for (const parity of [0, 1] as const) {
        try {
          if (
            (
              await recoverAddress({
                hash,
                signature: `0x${signature}${(27 + parity).toString(16)}`,
              })
            ).toLowerCase() === address.toLowerCase()
          )
            yParity = parity;
        } catch {}
      }
      if (yParity === undefined)
        throw new Error("KMS signature does not recover to configured key");
      return { r: viemToHex(r, { size: 32 }), s: viemToHex(s, { size: 32 }), yParity };
    };
    const sign = async ({ hash }: { hash: Hex }) => {
      const sig = await signDigest(hash);
      return `0x${sig.r.slice(2)}${sig.s.slice(2)}${(27 + sig.yParity).toString(16)}` as Hex;
    };
    this.account = toAccount({
      address,
      sign,
      async signMessage({ message }) {
        return sign({ hash: hashMessage(message) });
      },
      async signTypedData(data) {
        return sign({ hash: hashTypedData(data) });
      },
      async signTransaction(transaction, { serializer } = {}) {
        const serializerFn = serializer ?? serializeTransaction;
        const digest = keccak256(await serializerFn(transaction));
        const sig = await signDigest(digest);
        return serializerFn(transaction, sig) as Promise<Hex>;
      },
    });
    return this.account;
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
  replacePending(
    hash: string,
    root: `0x${string}`,
    sequence: bigint,
    signer: RootSigner,
  ): Promise<string>;
  getLatestSequence(): Promise<bigint>;
  getBalance(address: `0x${string}`): Promise<bigint>;
  chainId: bigint;
};
export type AnchorAlertSink = {
  emit(alert: {
    type: "anchor.stale" | "anchor.root_mismatch" | "anchor.wallet_low";
    fundId?: string;
    sequence?: bigint;
    details: string;
  }): Promise<void>;
};

export async function reconcileAnchors(
  sql: Sql,
  chain: RootChain,
  alerts: AnchorAlertSink,
  now = new Date(),
  walletAddress?: `0x${string}`,
): Promise<void> {
  if (walletAddress && (await chain.getBalance(walletAddress)) < 50_000_000_000_000_000n)
    await alerts.emit({
      type: "anchor.wallet_low",
      details: "Publisher balance is below 0.05 native token; fund it before anchoring is blocked",
    });
  const stale = await sql<{ fund_id: string; last_landed: Date | null }[]>`
    SELECT e.fund_id, MAX(a.confirmed_at) AS last_landed
    FROM (SELECT DISTINCT fund_id FROM fund_events) e
    LEFT JOIN anchors a ON a.fund_id = e.fund_id AND a.status = 'confirmed'
    WHERE EXISTS (SELECT 1 FROM fund_events f WHERE f.fund_id = e.fund_id AND f.seq > COALESCE((SELECT MAX(x.to_seq) FROM anchors x WHERE x.fund_id = e.fund_id AND x.status = 'confirmed'), 0))
    GROUP BY e.fund_id`;
  for (const row of stale)
    if (!row.last_landed || now.getTime() - new Date(row.last_landed).getTime() >= 60 * 60 * 1000)
      await alerts.emit({
        type: "anchor.stale",
        fundId: row.fund_id,
        details: "Events remain unanchored and no anchor has landed for at least one hour",
      });
  const anchors = await sql<
    { fund_id: string; root: string; chain_sequence: bigint }[]
  >`SELECT fund_id, root, chain_sequence FROM anchors WHERE status IN ('submitted', 'confirmed')`;
  for (const anchor of anchors) {
    const actual = await chain.getRoot(anchor.chain_sequence);
    if (actual.toLowerCase() !== `0x${anchor.root}`.toLowerCase())
      await alerts.emit({
        type: "anchor.root_mismatch",
        fundId: anchor.fund_id,
        sequence: anchor.chain_sequence,
        details: `On-chain root does not match local anchor ${anchor.chain_sequence}`,
      });
  }
}

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
  created_at: Date;
};
type EventRow = { seq: bigint; hash: string };

export class AnchoringWorker {
  constructor(
    private readonly sql: Sql,
    private readonly chain: RootChain,
    private readonly signer: RootSigner,
  ) {}

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
        const chainSequence = (await this.chain.getLatestSequence()) + 1n;
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
      const receipt = await this.chain.getReceipt(anchor.tx_hash);
      if (receipt?.status === "success" && receipt.blockNumber !== undefined) {
        if ((await this.chain.getBlockNumber()) - receipt.blockNumber + 1n >= 12n)
          await this
            .sql`UPDATE anchors SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ${anchor.id}`;
        return;
      }
      if (receipt?.status === "pending") {
        if (Date.now() - new Date(anchor.created_at).getTime() < 10 * 60 * 1000) return;
        const replacement = await this.chain.replacePending(
          anchor.tx_hash,
          `0x${anchor.root}`,
          sequence,
          this.signer,
        );
        await this.sql`UPDATE anchors SET tx_hash = ${replacement} WHERE id = ${anchor.id}`;
        return;
      }
      if (receipt === null) return;
      if (receipt.status === "failed") {
        await this.sql`UPDATE anchors SET status = 'failed' WHERE id = ${anchor.id}`;
        throw new Error("Anchor transaction failed; pg-boss will retry with exponential backoff");
      }
    }
    const published = await this.chain.getRoot(sequence);
    if (published.toLowerCase() === `0x${anchor.root}`.toLowerCase()) {
      const publication = await this.chain.getPublication(sequence);
      if (!publication)
        throw new Error("Root is present but its publication receipt is not yet available");
      await this
        .sql`UPDATE anchors SET status = 'submitted', tx_hash = ${publication.txHash} WHERE id = ${anchor.id}`;
      if ((await this.chain.getBlockNumber()) - publication.blockNumber + 1n >= 12n)
        await this
          .sql`UPDATE anchors SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ${anchor.id}`;
      return;
    }
    const latestSequence = await this.chain.getLatestSequence();
    if (sequence <= latestSequence) {
      throw new Error("Anchor sequence is already occupied by a different on-chain root");
    }
    const hash = await this.chain.publish(`0x${anchor.root}`, sequence, this.signer);
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
  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.getBalance({ address });
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
      maxFeePerGas: INITIAL_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: PRIORITY_FEE_PER_GAS,
    });
  }
  async replacePending(
    hash: string,
    root: `0x${string}`,
    sequence: bigint,
    signer: RootSigner,
  ): Promise<string> {
    const previous = await this.publicClient.getTransaction({ hash: hash as Hex });
    if (
      previous.nonce === undefined ||
      previous.maxFeePerGas === null ||
      previous.maxFeePerGas === undefined ||
      previous.maxPriorityFeePerGas === null ||
      previous.maxPriorityFeePerGas === undefined
    )
      throw new Error("Cannot replace a non-EIP-1559 pending anchor transaction");
    const bump = (fee: bigint) => (fee * 9n + 7n) / 8n;
    const maxFeePerGas = bump(previous.maxFeePerGas);
    const maxPriorityFeePerGas = bump(previous.maxPriorityFeePerGas);
    if (maxFeePerGas > MAX_FEE_PER_GAS || maxPriorityFeePerGas > MAX_PRIORITY_FEE_PER_GAS)
      throw new Error("Stuck anchor reached the configured fee ceiling; operator action required");
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
      nonce: previous.nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
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

export async function registerAnchorReconciliation(
  boss: PgBoss,
  sql: Sql,
  chain: RootChain,
  alerts: AnchorAlertSink,
  walletAddress?: `0x${string}`,
): Promise<void> {
  await boss.createQueue("blockchain-anchoring-reconcile");
  await boss.work("blockchain-anchoring-reconcile", { batchSize: 1 }, async () => {
    await reconcileAnchors(sql, chain, alerts, new Date(), walletAddress);
  });
  await boss.schedule("blockchain-anchoring-reconcile", "*/5 * * * *", {});
}

export function createAnchoringWorker(
  connectionString: string,
  chain: RootChain,
  signer: RootSigner,
): AnchoringWorker {
  return new AnchoringWorker(createSql(connectionString), chain, signer);
}
