import { parsePseudonymId } from "@yen/eventlog";
import { InMemoryExpenseStore } from "@yen/ledger";
import type { AuditBundle } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  type AuditBundleProvider,
  MemoryDisplayNameStore,
  MemoryFundStore,
} from "./dependencies.js";
import { devPolicy } from "./policy.js";

const owner = { id: "00000000-0000-4000-8000-000000000001", role: "owner" as const };
const fundId = "00000000-0000-4000-8000-000000000010";
const recordId = "00000000-0000-4000-8000-000000000020";

const parsedActor = parsePseudonymId("psn_00000000-0000-4000-8000-000000000021");

const testBundle: AuditBundle = {
  format: "yen/audit-bundle/v1",
  fund_id: fundId,
  chain: { start_seq: 0, start_hash: "0".repeat(64) },
  events: [
    {
      event: {
        fund_id: fundId,
        seq: 1,
        type: "expense.submitted",
        version: 1,
        actor: parsedActor,
        occurred_at: "2026-10-28T00:00:00.000Z",
        payload: { expense_id: recordId, amount_paise: 850000 },
        prev_hash: "0".repeat(64),
        hash: "1".repeat(64),
      },
      salt: "2".repeat(64),
      latest_event_hash: "1".repeat(64),
      eventProof: { index: 0, size: 1, path: [] },
      fundProof: { index: 0, size: 1, path: [] },
    },
  ],
  roots: [
    {
      start_seq: 1,
      end_seq: 1,
      event_root: "3".repeat(64),
      fund_count: 1,
      global_root: "4".repeat(64),
    },
  ],
  anchor: {
    chain_id: 80002,
    contract_address: "0x1111111111111111111111111111111111111111",
    tx_hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    root: "4".repeat(64),
    sequence: 1,
  },
};

const firstEvent = testBundle.events[0];
if (!firstEvent) {
  throw new Error("Missing first event in test bundle");
}

const mockAuditBundleProvider: AuditBundleProvider = {
  async getAuditBundle(id: string) {
    return id === fundId ? testBundle : null;
  },
  async getRecordProof(id: string, rId: string) {
    if (id !== fundId) return null;
    if (rId === recordId) {
      return {
        recordId,
        fundId,
        status: "anchored",
        event: firstEvent.event,
        salt: firstEvent.salt,
        latestEventHash: firstEvent.latest_event_hash,
        eventProof: firstEvent.eventProof,
        fundProof: firstEvent.fundProof,
        anchor: {
          chainId: testBundle.anchor.chain_id,
          contractAddress: testBundle.anchor.contract_address,
          txHash: testBundle.anchor.tx_hash,
          root: testBundle.anchor.root,
          sequence: testBundle.anchor.sequence,
        },
      };
    }
    if (rId === "pending-record") {
      return {
        recordId: "pending-record",
        fundId,
        status: "pending",
        event: firstEvent.event,
        pendingWindow: {
          message: "Sealed in tamper-evident event log; awaiting next scheduled batch anchor",
          estimatedAnchorMinutes: 10,
        },
      };
    }
    return null;
  },
};

function fixtureSetup() {
  const expenses = new InMemoryExpenseStore();
  const fundStore = new MemoryFundStore();
  const displayNameStore = new MemoryDisplayNameStore();

  const ownerApp = createApp({
    principal: owner,
    idGenerator: () => fundId,
    policy: devPolicy,
    displayNameStore,
    fundStore,
    expenseStore: expenses,
    auditBundleProvider: mockAuditBundleProvider,
  });

  const publicApp = createApp({
    principal: null,
    idGenerator: () => fundId,
    policy: devPolicy,
    displayNameStore,
    fundStore,
    expenseStore: expenses,
    auditBundleProvider: mockAuditBundleProvider,
  });

  return { ownerApp, publicApp };
}

async function createPublicFund(app: ReturnType<typeof createApp>) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "public-audit-fixture" },
    body: JSON.stringify({
      name: "Community fund",
      purpose: "Community festival fund",
      visibility: "public",
      targetPaise: "9000",
      upiVpa: "committee@yenbank",
      upiPayeeName: "Committee",
    }),
  });
  expect(response.status).toBe(201);
}

describe("Transparency & Audit Endpoints", () => {
  it("serves an audit bundle for a public fund", async () => {
    const { ownerApp, publicApp } = fixtureSetup();
    await createPublicFund(ownerApp);

    const response = await publicApp.request(`/v1/funds/${fundId}/audit-bundle`);
    expect(response.status).toBe(200);

    const bundle = (await response.json()) as {
      format: string;
      fund_id: string;
      events: unknown[];
      roots: unknown[];
      anchor: { chain_id: number };
    };
    expect(bundle.format).toBe("yen/audit-bundle/v1");
    expect(bundle.fund_id).toBe(fundId);
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(bundle.roots.length).toBeGreaterThan(0);
    expect(bundle.anchor).toBeDefined();
    expect(bundle.anchor.chain_id).toBe(80002);
  });

  it("serves proof for an anchored record", async () => {
    const { ownerApp, publicApp } = fixtureSetup();
    await createPublicFund(ownerApp);

    const response = await publicApp.request(`/v1/funds/${fundId}/records/${recordId}/proof`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      recordId: string;
      status: string;
      event: unknown;
      eventProof: unknown;
      fundProof: unknown;
      anchor: unknown;
    };
    expect(body.recordId).toBe(recordId);
    expect(body.status).toBe("anchored");
    expect(body.event).toBeDefined();
    expect(body.eventProof).toBeDefined();
    expect(body.fundProof).toBeDefined();
    expect(body.anchor).toBeDefined();
  });

  it("serves pending status for a draft or submitted record", async () => {
    const { ownerApp, publicApp } = fixtureSetup();
    await createPublicFund(ownerApp);

    const response = await publicApp.request(`/v1/funds/${fundId}/records/pending-record/proof`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      recordId: string;
      status: string;
      pendingWindow: { estimatedAnchorMinutes: number };
    };
    expect(body.recordId).toBe("pending-record");
    expect(body.status).toBe("pending");
    expect(body.pendingWindow).toBeDefined();
    expect(body.pendingWindow.estimatedAnchorMinutes).toBe(10);
  });

  it("returns 404 for a nonexistent record proof request", async () => {
    const { ownerApp, publicApp } = fixtureSetup();
    await createPublicFund(ownerApp);

    const response = await publicApp.request(
      `/v1/funds/${fundId}/records/00000000-0000-4000-8000-999999999999/proof`,
    );
    expect(response.status).toBe(404);
  });
});
