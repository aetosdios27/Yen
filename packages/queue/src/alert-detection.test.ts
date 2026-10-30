import { randomUUID } from "node:crypto";
import { appendEvent, createSql, migrate, type Sql } from "@yen/db";
import { parseFundId } from "@yen/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyFundChains } from "./alerts.js";
import {
  ANCHOR_MISSING_LAG_MS,
  AnchoringWorker,
  type ChainReceipt,
  type Publication,
  type RootChain,
  type RootSigner,
  reconcileAnchors,
} from "./anchoring.js";
import { describePostgres } from "./test-utils.js";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const FUND_CREATED_AT = "2026-10-30T10:00:00.000Z";

// Same fake as anchoring.test.ts: an in-memory chain whose publishes, receipts and roots are scripted.
class FakeChain implements RootChain {
  readonly chainId = 80002n;
  readonly roots = new Map<bigint, string>();
  readonly receipts = new Map<string, ChainReceipt>();
  readonly publications = new Map<bigint, Publication>();
  publishCount = 0;
  failNext = false;
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
    return 100n;
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
    return hash;
  }
  async replacePending(hash: string): Promise<string> {
    return hash;
  }
}

const noSigner: RootSigner = {
  getAccount: async () => {
    throw new Error("not used by fake chain");
  },
};

describePostgres("alert detection (queue)", (adminUrl) => {
  // Throwaway database per suite, dropped afterwards.
  const dbName = `yen_alert_detect_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const sql: Sql = createSql(url.toString());

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(dbName)}`;
    await migrate(sql);
  });
  afterAll(async () => {
    try {
      await sql.end({ timeout: 5 });
      await admin`DROP DATABASE IF EXISTS ${admin(dbName)}`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  async function seedFund(occurredAt = FUND_CREATED_AT): Promise<string> {
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
      occurredAt,
      payload: { org_id: orgId as never, visibility: "private" },
    });
    return fundId;
  }

  async function alertsFor(fundId: string, alertType: string) {
    return sql<
      { fund_id: string | null; alert_type: string; severity: string; entity_id: string | null }[]
    >`SELECT fund_id, alert_type, severity, entity_id FROM alerts
      WHERE fund_id = ${fundId} AND alert_type = ${alertType}`;
  }

  describe("chain_verification_failure", () => {
    it("raises one critical alert per broken fund chain and dedups repeat verification", async () => {
      const healthy = await seedFund();
      const broken = await seedFund();
      const brokenRow = await sql<{ hash: string }[]>`
        SELECT hash FROM fund_events WHERE fund_id = ${broken} AND seq = 1`;
      const hash = brokenRow[0]?.hash;
      if (hash === undefined) throw new Error("Expected a stored event hash");
      const flipped = `${hash[0] === "a" ? "b" : "a"}${hash.slice(1)}`;
      // Superuser tamper that bypasses the append-only triggers, as in the db chain tests.
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`;
        await tx`UPDATE fund_events SET hash = ${flipped} WHERE fund_id = ${broken} AND seq = 1`;
      });

      expect(await verifyFundChains(sql, NOW)).toBeGreaterThanOrEqual(1);
      const raised = await alertsFor(broken, "chain_verification_failure");
      expect(raised).toEqual([
        {
          fund_id: broken,
          alert_type: "chain_verification_failure",
          severity: "critical",
          entity_id: broken,
        },
      ]);
      expect(await alertsFor(healthy, "chain_verification_failure")).toHaveLength(0);

      await verifyFundChains(sql, NOW);
      expect(await alertsFor(broken, "chain_verification_failure")).toHaveLength(1);
    });
  });

  describe("anchor_missing", () => {
    it("does not alert just under the lag threshold and alerts once at it, while publishing fails", async () => {
      const fundId = await seedFund(FUND_CREATED_AT);
      const chain = new FakeChain();
      const worker = new AnchoringWorker(sql, chain, noSigner);
      // Publish lands as a failed transaction, then the retry path throws: anchoring is failing.
      chain.failNext = true;
      await worker.runFund(fundId);
      await expect(worker.runFund(fundId)).rejects.toThrow("retry with exponential backoff");

      const pendingSince = new Date(FUND_CREATED_AT).getTime();
      const justBelow = new Date(pendingSince + ANCHOR_MISSING_LAG_MS - 1);
      await reconcileAnchors(sql, chain, { emit: async () => {} }, justBelow);
      expect(await alertsFor(fundId, "anchor_missing")).toHaveLength(0);

      const atThreshold = new Date(pendingSince + ANCHOR_MISSING_LAG_MS);
      await reconcileAnchors(sql, chain, { emit: async () => {} }, atThreshold);
      expect(await alertsFor(fundId, "anchor_missing")).toEqual([
        {
          fund_id: fundId,
          alert_type: "anchor_missing",
          severity: "critical",
          entity_id: fundId,
        },
      ]);

      const later = new Date(pendingSince + ANCHOR_MISSING_LAG_MS + 5 * 60 * 1000);
      await reconcileAnchors(sql, chain, { emit: async () => {} }, later);
      expect(await alertsFor(fundId, "anchor_missing")).toHaveLength(1);
    });
  });

  describe("anchor_mismatch", () => {
    it("raises one critical alert when the on-chain root differs from the recomputed root, once per anchor", async () => {
      const fundId = await seedFund();
      const chain = new FakeChain();
      await new AnchoringWorker(sql, chain, noSigner).runFund(fundId);
      const anchor = (
        await sql<{ id: string; chain_sequence: bigint }[]>`
          SELECT id, chain_sequence FROM anchors WHERE fund_id = ${fundId}`
      )[0];
      if (!anchor) throw new Error("Expected a persisted anchor");

      await reconcileAnchors(sql, chain, { emit: async () => {} }, NOW);
      expect(await alertsFor(fundId, "anchor_mismatch")).toHaveLength(0);

      chain.roots.set(anchor.chain_sequence, `0x${"0".repeat(64)}`);
      await reconcileAnchors(sql, chain, { emit: async () => {} }, NOW);
      expect(await alertsFor(fundId, "anchor_mismatch")).toEqual([
        {
          fund_id: fundId,
          alert_type: "anchor_mismatch",
          severity: "critical",
          entity_id: anchor.id,
        },
      ]);

      await reconcileAnchors(sql, chain, { emit: async () => {} }, NOW);
      expect(await alertsFor(fundId, "anchor_mismatch")).toHaveLength(1);
    });
  });
});
