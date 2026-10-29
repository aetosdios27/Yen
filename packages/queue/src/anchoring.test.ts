import { spawn, spawnSync } from "node:child_process";
import { createPublicKey, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { KMSClient } from "@aws-sdk/client-kms";
import { appendEvent, createSql, migrate } from "@yen/db";
import { parseFundId } from "@yen/shared";
import { createPublicClient, createWalletClient, http, recoverAddress } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnchoringWorker,
  type ChainReceipt,
  KmsRootSigner,
  LocalDevRootSigner,
  type Publication,
  parseDerEcdsaSignature,
  type RootChain,
  type RootSigner,
  ViemRootChain,
} from "./anchoring.js";
import { DEFAULT_QUEUES } from "./config.js";
import { describePostgres } from "./test-utils.js";

describe("anchoring signers", () => {
  it("parses the known DER vector and normalizes high-s to low-s", () => {
    expect(
      parseDerEcdsaSignature(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02])),
    ).toEqual({ r: 1n, s: 2n });
  });

  it("signs through a fake KMS client and returns a recoverable EVM signature", async () => {
    const local = privateKeyToAccount(generatePrivateKey());
    const publicKey = local.publicKey;
    const spki = createPublicKey({
      key: {
        kty: "EC",
        crv: "secp256k1",
        x: Buffer.from(publicKey.slice(4, 68), "hex").toString("base64url"),
        y: Buffer.from(publicKey.slice(68), "hex").toString("base64url"),
      },
      format: "jwk",
    }).export({ format: "der", type: "spki" });
    let signCalls = 0;
    const fakeClient = {
      async send(command: { constructor: { name: string }; input: { Message?: Uint8Array } }) {
        if (command.constructor.name === "GetPublicKeyCommand")
          return { SigningAlgorithms: ["ECDSA_SHA_256"], PublicKey: spki };
        signCalls += 1;
        const digest =
          `0x${Buffer.from(command.input.Message ?? []).toString("hex")}` as `0x${string}`;
        const signature = await local.sign({ hash: digest });
        const r = signature.slice(2, 66);
        const s = signature.slice(66, 130);
        const encodeInteger = (value: string) => {
          const bytes = Buffer.from(value.replace(/^0+/, "") || "00", "hex");
          const hasSignBit = ((bytes[0] ?? 0) & 0x80) !== 0;
          return [0x02, bytes.length + (hasSignBit ? 1 : 0), ...(hasSignBit ? [0] : []), ...bytes];
        };
        const rDer = encodeInteger(r);
        const sDer = encodeInteger(s);
        const body = [...rDer, ...sDer];
        return { Signature: Uint8Array.from([0x30, body.length, ...body]) };
      },
    } as unknown as KMSClient;
    const account = await new KmsRootSigner("fake-key", {}, fakeClient).getAccount();
    expect(account.address).toBe(local.address);
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const signature = await account.sign?.({ hash });
    expect(signature).toBeTruthy();
    expect(await recoverAddress({ hash, signature: signature as `0x${string}` })).toBe(
      local.address,
    );
    expect(signCalls).toBe(1);
  });
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

  it("fails closed when KMS signing is not configured", async () => {
    await expect(new KmsRootSigner(undefined).getAccount()).rejects.toThrow(
      "ANCHOR_KMS_KEY_ID is required",
    );
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
  async getBalance(): Promise<bigint> {
    return 1_000_000_000_000_000_000n;
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

it.skipIf(
  spawnSync("anvil", ["--version"], { stdio: "ignore" }).status !== 0 ||
    !process.env.YEN_ANVIL_TEST_DATABASE_URL,
)(
  "deploys RootRegistry and publishes a root on a real local Anvil chain",
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
      const account = mnemonicToAccount(
        "test test test test test test test test test test test junk",
        { addressIndex: 0 },
      );
      const wallet = createWalletClient({ account, chain: foundry, transport: http(rpc) });
      const artifact = JSON.parse(
        await readFile(resolve("../../contracts/out/RootRegistry.sol/RootRegistry.json"), "utf8"),
      ) as { abi: readonly unknown[]; bytecode: { object: string } };
      const deploymentHash = await wallet.deployContract({
        abi: artifact.abi as never,
        bytecode: artifact.bytecode.object as `0x${string}`,
        args: [account.address],
      });
      const deployment = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
      expect(deployment.contractAddress).toBeTruthy();
      const chain = new ViemRootChain(rpc, deployment.contractAddress as `0x${string}`, foundry);
      const anvilDatabaseUrl = process.env.YEN_ANVIL_TEST_DATABASE_URL;
      if (!anvilDatabaseUrl) throw new Error("Anvil integration database URL is required");
      const database = createSql(anvilDatabaseUrl);
      await migrate(database);
      await database`TRUNCATE anchor_event_salts, anchors`;
      const fundId = randomUUID();
      const userId = randomUUID();
      const orgId = randomUUID();
      const phone = `+919${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
      await database`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Anvil')`;
      await database`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Anvil', 'society', ${userId})`;
      await database`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Anvil', '{}')`;
      const parsedFundId = parseFundId(fundId);
      if (!parsedFundId.ok) throw new Error("Generated invalid fund ID");
      await appendEvent(database, {
        fundId: parsedFundId.value,
        type: "fund.created",
        version: 1,
        actor: `psn_${randomUUID()}` as never,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId as never, visibility: "private" },
      });
      let broadcastCount = 0;
      const crashAfterBroadcast: RootChain = {
        chainId: chain.chainId,
        getRoot: (sequence) => chain.getRoot(sequence),
        getReceipt: (hash) => chain.getReceipt(hash),
        getPublication: (sequence) => chain.getPublication(sequence),
        getBlockNumber: () => chain.getBlockNumber(),
        getLatestSequence: () => chain.getLatestSequence(),
        getBalance: (address) => chain.getBalance(address),
        async publish(root, sequence, signer) {
          broadcastCount += 1;
          const txHash = await chain.publish(root, sequence, signer);
          await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
          throw new Error("simulated worker termination after broadcast");
        },
        async replacePending(hash) {
          return hash;
        },
      };
      const signer = { getAccount: async () => account } satisfies RootSigner;
      await expect(
        new AnchoringWorker(database, crashAfterBroadcast, signer).runFund(fundId),
      ).rejects.toThrow("simulated worker termination");
      const persistedRoot = await database<
        { root: string }[]
      >`SELECT root FROM anchors WHERE fund_id = ${fundId}`;
      expect(await chain.getRoot(1n)).toBe(`0x${persistedRoot[0]?.root}`);
      await new AnchoringWorker(database, chain, signer).runFund(fundId);
      const local = await database<
        { root: string; status: string }[]
      >`SELECT root, status FROM anchors WHERE fund_id = ${fundId}`;
      const root = `0x${local[0]?.root}` as `0x${string}`;
      expect(local).toHaveLength(1);
      expect(local[0]?.status).toBe("submitted");
      expect(await chain.getRoot(1n)).toBe(root);
      expect(await chain.getLatestSequence()).toBe(1n);
      expect(broadcastCount).toBe(1);
      const publications = await publicClient.getLogs({
        address: deployment.contractAddress as `0x${string}`,
        event: {
          type: "event",
          name: "RootPublished",
          inputs: [
            { name: "sequence", type: "uint64", indexed: true },
            { name: "root", type: "bytes32", indexed: true },
            { name: "publisher", type: "address", indexed: true },
          ],
        },
        fromBlock: deployment.blockNumber,
      });
      expect(publications).toHaveLength(1);
      await database.end({ timeout: 5 });
    } finally {
      child.kill("SIGTERM");
    }
  },
  20_000,
);
