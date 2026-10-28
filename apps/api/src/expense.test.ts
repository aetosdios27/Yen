import {
  computeExpenseApprovalChallenge,
  createMockPasskeyApproval,
  InMemoryExpenseStore,
  type PseudonymId,
  verifyPasskeyBinding,
} from "@yen/ledger";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppDependencies } from "./dependencies.js";
import { devPolicy } from "./policy.js";

const FUND_ID = "00000000-0000-4000-8000-000000000001";
const REQUESTER = { id: "00000000-0000-4000-8000-000000000010" };
const APPROVER_1 = { id: "00000000-0000-4000-8000-000000000021" };
const APPROVER_2 = { id: "00000000-0000-4000-8000-000000000022" };

function setup(overrides: Partial<AppDependencies> = {}) {
  let now = 1700000000000;
  let sequence = 100;
  const idGenerator = vi.fn(
    () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  );
  const app = createApp({
    principal: REQUESTER,
    clock: () => now,
    idGenerator,
    policy: devPolicy,
    // Test-only: this validates challenge binding but does not verify a real signature.
    approvalProofVerifier: verifyPasskeyBinding,
    ...overrides,
  });
  return {
    app,
    idGenerator,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function req(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (key) {
    headers["Idempotency-Key"] = key;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

interface ExpensePayload {
  readonly id: string;
  readonly fundId: string;
  readonly requesterId: string;
  readonly amountPaise: string;
  readonly status: string;
  readonly holdId: string | null;
  readonly approvalsCount: number;
  readonly approvedAt?: string;
  readonly bankTransactionId?: string;
  readonly paidAt?: string;
  readonly reconciledAt?: string;
  readonly rejectionReason?: string;
  readonly description?: string;
  readonly length?: number;
  readonly [key: string]: unknown;
}

async function json<T = ExpensePayload>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("Expense Requests API Routes (YEN-30)", () => {
  it("creates a draft expense request with Idempotency-Key", async () => {
    const { app } = setup();

    const input = {
      amountPaise: "45000",
      description: "Sound equipment for annual gathering",
      recipientRef: "rcpt_sound_01",
    };

    const res1 = await app.request(
      req("POST", `/v1/funds/${FUND_ID}/expenses`, input, "create-exp-1"),
    );
    expect(res1.status).toBe(201);
    const body1 = await json(res1);
    expect(body1.id).toBeDefined();
    expect(body1.fundId).toBe(FUND_ID);
    expect(body1.requesterId).toBe(REQUESTER.id);
    expect(body1.amountPaise).toBe("45000");
    expect(body1.status).toBe("draft");
    expect(body1.holdId).toBeNull();
    expect(body1.approvalsCount).toBe(0);

    // Replay with identical key
    const res2 = await app.request(
      req("POST", `/v1/funds/${FUND_ID}/expenses`, input, "create-exp-1"),
    );
    expect(res2.status).toBe(201);
    expect(res2.headers.get("idempotent-replayed")).toBe("true");
    const body2 = await json(res2);
    expect(body2.id).toBe(body1.id);

    // Conflict on changed body with same key
    const res3 = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        { ...input, amountPaise: "99999" },
        "create-exp-1",
      ),
    );
    expect(res3.status).toBe(409);
  });

  it("validates create expense input", async () => {
    const { app } = setup();

    // Invalid amount (negative or not decimal string)
    const res1 = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        { amountPaise: "-100", description: "Invalid", recipientRef: "rcpt" },
        "bad-1",
      ),
    );
    expect(res1.status).toBe(400);

    // Empty description
    const res2 = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        { amountPaise: "1000", description: "", recipientRef: "rcpt" },
        "bad-2",
      ),
    );
    expect(res2.status).toBe(400);
  });

  it("gets and lists expense requests", async () => {
    const { app } = setup();

    const input1 = {
      amountPaise: "10000",
      description: "Item 1",
      recipientRef: "rcpt_1",
    };
    const input2 = {
      amountPaise: "20000",
      description: "Item 2",
      recipientRef: "rcpt_2",
    };

    const c1 = await app.request(
      req("POST", `/v1/funds/${FUND_ID}/expenses`, input1, "list-exp-1"),
    );
    const b1 = await json(c1);
    await app.request(req("POST", `/v1/funds/${FUND_ID}/expenses`, input2, "list-exp-2"));

    // Get specific expense
    const getRes = await app.request(req("GET", `/v1/funds/${FUND_ID}/expenses/${b1.id}`));
    expect(getRes.status).toBe(200);
    const getBody = await json(getRes);
    expect(getBody.id).toBe(b1.id);
    expect(getBody.description).toBe("Item 1");

    // List all expenses
    const listRes = await app.request(req("GET", `/v1/funds/${FUND_ID}/expenses`));
    expect(listRes.status).toBe(200);
    const listBody = await json(listRes);
    expect(listBody).toHaveLength(2);

    // Not found for nonexistent
    const missingRes = await app.request(
      req("GET", `/v1/funds/${FUND_ID}/expenses/00000000-0000-4000-8000-000000000999`),
    );
    expect(missingRes.status).toBe(404);
  });

  it("executes complete lifecycle: draft -> submitted -> approved -> paid -> reconciled", async () => {
    const expenseStore = new InMemoryExpenseStore();
    const { app } = setup({ expenseStore });

    // 1. Create draft
    const createRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        {
          amountPaise: "50000",
          description: "Generator fuel and maintenance",
          recipientRef: "rcpt_fuel_vendor",
        },
        "lifecycle-create",
      ),
    );
    expect(createRes.status).toBe(201);
    const created = await json(createRes);
    expect(created.status).toBe("draft");

    // 2. Submit (creates ledger hold)
    const submitRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/submit`,
        undefined,
        "lifecycle-submit",
      ),
    );
    expect(submitRes.status).toBe(200);
    const submitted = await json(submitRes);
    expect(submitted.status).toBe("submitted");
    expect(submitted.holdId).toBeDefined();

    // Cannot submit again
    const reSubmitRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/submit`,
        undefined,
        "lifecycle-resubmit",
      ),
    );
    expect(reSubmitRes.status).toBe(409);

    // 3. Approvals
    // Separation of duties: requester cannot approve!
    const requesterApp = createMockPasskeyApproval(
      REQUESTER.id as PseudonymId,
      { id: created.id, fundId: FUND_ID, amountPaise: paise(50000) },
      new Date().toISOString(),
    );
    const selfAppRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/approve`,
        requesterApp.passkeySignature,
        "lifecycle-self-approve",
      ),
    );
    expect(selfAppRes.status).toBe(403);

    // Approvers sign using approver principals on the same app/store
    const app1 = setup({ principal: APPROVER_1, expenseStore }).app;
    const app1Data = createMockPasskeyApproval(
      APPROVER_1.id as PseudonymId,
      { id: created.id, fundId: FUND_ID, amountPaise: paise(50000) },
      new Date().toISOString(),
    );
    const app1Res = await app1.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/approve`,
        app1Data.passkeySignature,
        "lifecycle-app-1",
      ),
    );
    expect(app1Res.status).toBe(200);
    const app1Body = await json(app1Res);
    expect(app1Body.status).toBe("submitted"); // Quorum is 2
    expect(app1Body.approvalsCount).toBe(1);

    // Approver 2 signs: reaches quorum of 2!
    const app2 = setup({ principal: APPROVER_2, expenseStore }).app;
    const app2Data = createMockPasskeyApproval(
      APPROVER_2.id as PseudonymId,
      { id: created.id, fundId: FUND_ID, amountPaise: paise(50000) },
      new Date().toISOString(),
    );
    const app2Res = await app2.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/approve`,
        app2Data.passkeySignature,
        "lifecycle-app-2",
      ),
    );
    expect(app2Res.status).toBe(200);
    const app2Body = await json(app2Res);
    expect(app2Body.status).toBe("approved");
    expect(app2Body.approvedAt).toBeDefined();
    expect(app2Body.approvalsCount).toBe(2);

    // 4. Pay (commits hold)
    const bankTxId = "00000000-0000-4000-8000-000000000077";
    const payRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/pay`,
        { bankTransactionId: bankTxId },
        "lifecycle-pay",
      ),
    );
    expect(payRes.status).toBe(200);
    const paidBody = await json(payRes);
    expect(paidBody.status).toBe("paid");
    expect(paidBody.paidAt).toBeDefined();
    expect(paidBody.bankTransactionId).toBe(bankTxId);

    const mismatchedReconcile = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/reconcile`,
        { bankTransactionId: "00000000-0000-4000-8000-000000000078" },
        "lifecycle-reconcile-wrong-bank-tx",
      ),
    );
    expect(mismatchedReconcile.status).toBe(409);

    // 5. Reconcile
    const reconcileRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/reconcile`,
        { bankTransactionId: bankTxId },
        "lifecycle-reconcile",
      ),
    );
    expect(reconcileRes.status).toBe(200);
    const reconciledBody = await json(reconcileRes);
    expect(reconciledBody.status).toBe("reconciled");
    expect(reconciledBody.reconciledAt).toBeDefined();
  });

  it("rejects approval when no cryptographic proof verifier is configured", async () => {
    const expenseStore = new InMemoryExpenseStore();
    const app = createApp({ principal: REQUESTER, policy: devPolicy, expenseStore });
    const createRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        { amountPaise: "50000", description: "Supplies", recipientRef: "recipient-1" },
        "proof-create",
      ),
    );
    const created = await json(createRes);
    await app.request(
      req("POST", `/v1/funds/${FUND_ID}/expenses/${created.id}/submit`, undefined, "proof-submit"),
    );

    const approverApp = createApp({ principal: APPROVER_1, policy: devPolicy, expenseStore });
    const forgedProof = {
      credentialId: "attacker-controlled-credential",
      signatureHex: "00",
      clientDataJson: JSON.stringify({
        type: "webauthn.get",
        challenge: computeExpenseApprovalChallenge(created.id, FUND_ID, paise(50000)),
      }),
      authenticatorDataHex: "00",
    };
    const result = await approverApp.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/approve`,
        forgedProof,
        "proof-forgery",
      ),
    );

    expect(result.status).toBe(400);
    expect((await expenseStore.get(created.id))?.approvals).toHaveLength(0);
  });

  it("handles rejection flow: draft -> submitted -> rejected", async () => {
    const { app } = setup();

    const createRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses`,
        {
          amountPaise: "30000",
          description: "Stage decor",
          recipientRef: "rcpt_decor",
        },
        "reject-create",
      ),
    );
    const created = await json(createRes);

    await app.request(
      req("POST", `/v1/funds/${FUND_ID}/expenses/${created.id}/submit`, undefined, "reject-submit"),
    );

    const rejectRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/reject`,
        { reason: "policy" },
        "reject-action",
      ),
    );
    expect(rejectRes.status).toBe(200);
    const rejectedBody = await json(rejectRes);
    expect(rejectedBody.status).toBe("rejected");
    expect(rejectedBody.rejectionReason).toBe("policy");

    // Cannot pay a rejected expense
    const payRes = await app.request(
      req(
        "POST",
        `/v1/funds/${FUND_ID}/expenses/${created.id}/pay`,
        { bankTransactionId: "00000000-0000-4000-8000-000000000088" },
        "pay-rejected",
      ),
    );
    expect(payRes.status).toBe(409);
  });
});
