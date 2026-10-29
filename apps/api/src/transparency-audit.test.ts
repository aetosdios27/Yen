import { type ExpenseRequest, InMemoryExpenseStore } from "@yen/ledger";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryDisplayNameStore, MemoryFundStore } from "./dependencies.js";
import { devPolicy } from "./policy.js";

const owner = { id: "00000000-0000-4000-8000-000000000001", role: "owner" as const };
const fundId = "00000000-0000-4000-8000-000000000010";
const recordId = "00000000-0000-4000-8000-000000000020";

function fixtureSetup(expensesList: ExpenseRequest[] = []) {
  const expenses = new InMemoryExpenseStore();
  const fundStore = new MemoryFundStore();
  const displayNameStore = new MemoryDisplayNameStore();

  const ownerApp = createApp({
    principal: owner,
    idGenerator: () => fundId,
    policy: devPolicy,
    displayNameStore,
    fundStore,
    expenseStore: {
      ...expenses,
      get: expenses.get.bind(expenses),
      list: async (id: string) => (id === fundId ? expensesList : []),
      save: expenses.save.bind(expenses),
      atomicApprove: expenses.atomicApprove.bind(expenses),
    },
  });

  const publicApp = createApp({
    principal: null,
    idGenerator: () => fundId,
    policy: devPolicy,
    displayNameStore,
    fundStore,
    expenseStore: {
      ...expenses,
      get: expenses.get.bind(expenses),
      list: async (id: string) => (id === fundId ? expensesList : []),
      save: expenses.save.bind(expenses),
      atomicApprove: expenses.atomicApprove.bind(expenses),
    },
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
    const expense = {
      id: recordId,
      fundId,
      requesterId: "psn_00000000-0000-4000-8000-000000000021" as ExpenseRequest["requesterId"],
      amountPaise: paise(850000),
      description: "Sound equipment rental",
      status: "paid",
      createdAt: "2026-10-28T00:00:00.000Z",
      submittedAt: "2026-10-28T00:00:00.000Z",
      paidAt: "2026-10-28T01:00:00.000Z",
      evidence: [],
      approvals: [],
    } as unknown as ExpenseRequest;

    const { ownerApp, publicApp } = fixtureSetup([expense]);
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
    const expense = {
      id: recordId,
      fundId,
      requesterId: "psn_00000000-0000-4000-8000-000000000021" as ExpenseRequest["requesterId"],
      amountPaise: paise(850000),
      description: "Sound equipment rental",
      status: "paid",
      createdAt: "2026-10-28T00:00:00.000Z",
      submittedAt: "2026-10-28T00:00:00.000Z",
      paidAt: "2026-10-28T01:00:00.000Z",
      evidence: [],
      approvals: [],
    } as unknown as ExpenseRequest;

    const { ownerApp, publicApp } = fixtureSetup([expense]);
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
    const expense = {
      id: recordId,
      fundId,
      requesterId: "psn_00000000-0000-4000-8000-000000000021" as ExpenseRequest["requesterId"],
      amountPaise: paise(850000),
      description: "Sound equipment rental",
      status: "submitted",
      createdAt: "2026-10-28T00:00:00.000Z",
      submittedAt: "2026-10-28T00:00:00.000Z",
      evidence: [],
      approvals: [],
    } as unknown as ExpenseRequest;

    const { ownerApp, publicApp } = fixtureSetup([expense]);
    await createPublicFund(ownerApp);

    const response = await publicApp.request(`/v1/funds/${fundId}/records/${recordId}/proof`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      recordId: string;
      status: string;
      pendingWindow: { estimatedAnchorMinutes: number };
    };
    expect(body.recordId).toBe(recordId);
    expect(body.status).toBe("pending");
    expect(body.pendingWindow).toBeDefined();
    expect(body.pendingWindow.estimatedAnchorMinutes).toBe(10);
  });

  it("returns 404 for a nonexistent record proof request", async () => {
    const { ownerApp, publicApp } = fixtureSetup([]);
    await createPublicFund(ownerApp);

    const response = await publicApp.request(
      `/v1/funds/${fundId}/records/00000000-0000-4000-8000-999999999999/proof`,
    );
    expect(response.status).toBe(404);
  });
});
