import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { appendEvent, createSql, migrate } from "@yen/db";
import { parseFundId } from "@yen/shared";
import { createPublicClient, createWalletClient, http } from "viem";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnchoringWorker,
  type ChainReceipt,
  KmsRootSigner,
  LocalDevRootSigner,
  type Publication,
  type RootChain,
  type RootSigner,
} from "./anchoring.js";
import { DEFAULT_QUEUES } from "./config.js";
import { describePostgres } from "./test-utils.js";

const anvilInstalled = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;

describe("anchoring signers", () => {
  it("loads the local development key only from its environment and exposes its account", async () => {
    const signer = LocalDevRootSigner.fromEnvironment({
      ANCHOR_PRIVATE_KEY: `0x${"01".padStart(64, "0")}`,
    } as NodeJS.ProcessEnv);
    const account = await signer.getAccount();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("fails closed when local signing is not configured", () => {
    expect(() => LocalDevRootSigner.fromEnvironment({})).toThrow("ANCHOR_PRIVATE_KEY is required");
  });

  it("keeps the KMS adapter unavailable until its provider is configured", async () => {
    await expect(new KmsRootSigner().getAccount()).rejects.toThrow("KMS signer is not configured");
  });
});

class FakeChain implements RootChain {
  readonly chainId = 80002n;
  readonly roots = new Map<bigint, string>();
  readonly receipts = new Map<string, ChainReceipt>();
  readonly publications = new Map<bigint, Publication>();
  publishCount = 0;
  crashAfterFirstBroadcast = false;
  failNext = false;
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
    return 100n;
  }
  async getLatestSequence(): Promise<bigint> {
    return [...this.roots.keys()].reduce(
      (latest, sequence) => (sequence > latest ? sequence : latest),
      0n,
    );
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
}

describePostgres("anchoring worker", (adminUrl) => {
  const sql = createSql(adminUrl);
  beforeAll(async () => migrate(sql));
  afterAll(async () => sql.end({ timeout: 5 }));

  async function seedFund(): Promise<string> {
    const fundId = randomUUID();
    const userId = randomUUID();
    const orgId = randomUUID();
    const phone = `+919${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Test')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Test', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Test', '{}')`;
    const parsed = parseFundId(fundId);
    if (!parsed.ok) throw new Error("Generated invalid fund ID");
    await appendEvent(sql, {
      fundId: parsed.value,
      type: "fund.created",
      version: 1,
      actor: `psn_${randomUUID()}` as never,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { org_id: orgId as never, visibility: "private" },
    });
    return fundId;
  }

  it("recovers a broadcast with no persisted hash after restart without submitting twice", async () => {
    const fundId = await seedFund();
    const chain = new FakeChain();
    chain.crashAfterFirstBroadcast = true;
    const signer = {
      getAccount: async () => {
        throw new Error("not used by fake chain");
      },
    } satisfies RootSigner;
    const worker = new AnchoringWorker(sql, chain, signer);
    await expect(worker.runFund(fundId)).rejects.toThrow("simulated process kill");
    await new AnchoringWorker(sql, chain, signer).runFund(fundId);
    const anchors = await sql<
      { status: string; tx_hash: string | null }[]
    >`SELECT status, tx_hash FROM anchors WHERE fund_id = ${fundId}`;
    expect(chain.publishCount).toBe(1);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ status: "submitted", tx_hash: expect.any(String) });
  });

  it("retries a failed chain transaction using the same durable anchor and retry backoff policy", async () => {
    const fundId = await seedFund();
    const chain = new FakeChain();
    chain.failNext = true;
    const signer = {
      getAccount: async () => {
        throw new Error("not used by fake chain");
      },
    } satisfies RootSigner;
    const worker = new AnchoringWorker(sql, chain, signer);
    await worker.runFund(fundId);
    await expect(worker.runFund(fundId)).rejects.toThrow("retry with exponential backoff");
    await worker.runFund(fundId);
    const anchors = await sql<
      { id: string; status: string }[]
    >`SELECT id, status FROM anchors WHERE fund_id = ${fundId}`;
    expect(chain.publishCount).toBe(2);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.status).toBe("submitted");
    expect(DEFAULT_QUEUES["blockchain-anchoring"]).toMatchObject({
      retryBackoff: true,
      retryDelay: 60,
    });
  });

  it("creates no anchor for an empty fund", async () => {
    const fundId = randomUUID();
    const userId = randomUUID();
    const orgId = randomUUID();
    const phone = `+919${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Test')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Test', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Test', '{}')`;
    const chain = new FakeChain();
    const signer = {
      getAccount: async () => {
        throw new Error("not used by fake chain");
      },
    } satisfies RootSigner;
    await new AnchoringWorker(sql, chain, signer).runFund(fundId);
    expect(await sql`SELECT id FROM anchors WHERE fund_id = ${fundId}`).toHaveLength(0);
    expect(chain.publishCount).toBe(0);
  });
});

it.skipIf(!anvilInstalled)(
  "broadcasts and confirms a local development transaction on Anvil",
  async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate Anvil port");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port)], {
      stdio: "ignore",
    });
    try {
      const rpc = `http://127.0.0.1:${port}`;
      const publicClient = createPublicClient({ chain: foundry, transport: http(rpc) });
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          if ((await publicClient.getChainId()) === foundry.id) break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(await publicClient.getChainId()).toBe(foundry.id);
      const account = await LocalDevRootSigner.fromEnvironment({
        ANCHOR_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      } as NodeJS.ProcessEnv).getAccount();
      const wallet = createWalletClient({ account, chain: foundry, transport: http(rpc) });
      const hash = await wallet.sendTransaction({ to: account.address, value: 0n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    } finally {
      child.kill("SIGTERM");
    }
  },
  20_000,
);
