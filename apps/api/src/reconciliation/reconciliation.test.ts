import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createApp } from "../app.js";
import { statementUploadResultSchema, unmatchedCreditsSchema } from "../contract.js";
import type { AppDependencies } from "../dependencies.js";
import { devPolicy } from "../policy.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };
const otherPrincipal = { id: "00000000-0000-4000-8000-000000000002" };

const fundInput = {
  name: "RoboCup 2026 Fund",
  targetPaise: "10000000",
  upiVpa: "robocup@yenbank",
  upiPayeeName: "RoboCup IITD",
};

function setup(overrides: Partial<AppDependencies> = {}) {
  let now = new Date("2026-10-28T12:00:00.000Z").getTime();
  let sequence = 100;
  const app = createApp({
    principal,
    clock: () => now,
    idGenerator: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    logger: { log: () => undefined },
    policy: devPolicy,
    ...overrides,
  });
  return {
    app,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

async function createFund(app: ReturnType<typeof setup>["app"]): Promise<string> {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": `fund-${Date.now()}` },
    body: JSON.stringify(fundInput),
  });
  expect(response.status).toBe(201);
  return z.object({ id: z.string().uuid() }).parse(await response.json()).id;
}

async function pledgeDonation(
  app: ReturnType<typeof setup>["app"],
  fundId: string,
  amountPaise: string,
  utr: string,
  donorName?: string,
  key = `pledge-${utr}`,
) {
  const response = await app.request(`/v1/funds/${fundId}/donations/pledge`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      amountPaise,
      utr,
      ...(donorName ? { donorName } : {}),
    }),
  });
  expect(response.status).toBe(201);
  return z
    .object({
      donationId: z.string().uuid(),
      fundId: z.string().uuid(),
      status: z.literal("pledged"),
      amountPaise: z.string(),
    })
    .parse(await response.json());
}

describe("Reconciliation Engine Integration", () => {
  it("ingests HDFC CSV statement, matches pledges via exact UTR, and is idempotent on replay", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    // 1. Create two donor pledges matching rows in sandbox HDFC statement:
    // Row 1: 500.00 (50000 paise), UTR: 123456789012
    const p1 = await pledgeDonation(app, fundId, "50000", "123456789012", "Rahul Sharma");
    // Row 2: 1250.00 (125000 paise), UTR: 234567890123
    const p2 = await pledgeDonation(app, fundId, "125000", "234567890123", "Priya Patel");

    const hdfcCsv = await readFile(
      new URL("./fixtures/sandbox-hdfc-statement.csv", import.meta.url),
      "utf8",
    );

    // 2. Ingest bank statement
    const uploadRes = await app.request("/v1/reconciliation/statements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fundId, csvContent: hdfcCsv }),
    });

    expect(uploadRes.status).toBe(200);
    const result = statementUploadResultSchema.parse(await uploadRes.json());

    expect(result).toMatchObject({
      totalProcessed: 6,
      ingestedCount: 6,
      matchedCount: 2,
      unmatchedCount: 3, // NEFT credit 50000.00 + 2 ambiguous/unpledged credits 2000.00
      duplicateCount: 0,
    });

    // Check matched transactions
    const tx1 = result.transactions.find(
      (t: { utr?: string | undefined }) => t.utr === "123456789012",
    );
    expect(tx1).toMatchObject({
      reconciliationStatus: "matched",
      matchedPledgeId: p1.donationId,
      amountPaise: "50000",
      type: "credit",
    });

    const tx2 = result.transactions.find(
      (t: { utr?: string | undefined }) => t.utr === "234567890123",
    );
    expect(tx2).toMatchObject({
      reconciliationStatus: "matched",
      matchedPledgeId: p2.donationId,
      amountPaise: "125000",
      type: "credit",
    });

    // 3. Replay exact same statement (idempotency test)
    const replayRes = await app.request("/v1/reconciliation/statements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fundId, csvContent: hdfcCsv }),
    });

    expect(replayRes.status).toBe(200);
    const replayResult = statementUploadResultSchema.parse(await replayRes.json());

    expect(replayResult).toMatchObject({
      totalProcessed: 6,
      ingestedCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      duplicateCount: 6,
    });
    for (const tx of replayResult.transactions) {
      expect(tx.duplicate).toBe(true);
    }
  });

  it("processes partner webhook idempotently and reconciles credit", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    const utr = "998877665544";
    const pledge = await pledgeDonation(app, fundId, "75000", utr, "Webhook Donor");

    const webhookPayload = {
      event: "virtual_account.credited",
      timestamp: "2026-10-28T14:30:00.000Z",
      data: {
        fund_id: fundId,
        bank_reference: "PAY_PARTNER_001",
        amount_paise: 75000,
        type: "credit",
        posted_at: "2026-10-28T14:29:00.000Z",
        utr,
        narration: `UPI/CR/${utr}/DONATION`,
        counterparty: {
          vpa: "donor@upi",
          name: "Webhook Donor",
        },
      },
    };

    // First webhook call
    const firstRes = await app.request("/v1/reconciliation/webhooks/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody).toMatchObject({
      status: "processed",
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
      duplicate: false,
    });

    // Replay identical webhook (idempotent receiver)
    const secondRes = await app.request("/v1/reconciliation/webhooks/partner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody).toMatchObject({
      status: "processed",
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
      duplicate: true,
    });
  });

  it("serves unmatched review queue and performs manual match with audit reason", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    // Create two donor pledges for 2000.00 (200000 paise) to test ambiguous match routing to unmatched queue
    const pledge1 = await pledgeDonation(
      app,
      fundId,
      "200000",
      "999000111222",
      "Ambiguous Donor 1",
    );
    const pledge2 = await pledgeDonation(
      app,
      fundId,
      "200000",
      "999000333444",
      "Ambiguous Donor 2",
    );

    const hdfcCsv = await readFile(
      new URL("./fixtures/sandbox-hdfc-statement.csv", import.meta.url),
      "utf8",
    );

    // Ingest statement which has two 2000.00 credit rows (ambiguous match, so routed to unmatched)
    await app.request("/v1/reconciliation/statements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fundId, csvContent: hdfcCsv }),
    });

    // 1. Fetch unmatched review queue
    const queueRes = await app.request(`/v1/funds/${fundId}/reconciliation/unmatched`);
    expect(queueRes.status).toBe(200);
    const queue = unmatchedCreditsSchema.parse(await queueRes.json());

    expect(Array.isArray(queue)).toBe(true);
    // Find the unmatched 200000 paise credits
    const unmatched2000 = queue.filter(
      (item: { amountPaise: string }) => item.amountPaise === "200000",
    );
    expect(unmatched2000.length).toBe(2);

    const targetCredit = unmatched2000[0];
    expect(targetCredit).toBeDefined();
    if (!targetCredit) throw new Error("Expected targetCredit to exist");
    expect(targetCredit.candidates.length).toBe(2);
    const candidateIds = targetCredit.candidates.map((c: { pledgeId: string }) => c.pledgeId);
    expect(candidateIds).toContain(pledge1.donationId);
    expect(candidateIds).toContain(pledge2.donationId);

    // 2. Perform manual match with audit reason
    const matchRes = await app.request(`/v1/funds/${fundId}/reconciliation/manual-match`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-1" },
      body: JSON.stringify({
        bankTransactionId: targetCredit.id,
        pledgeId: pledge1.donationId,
        reason: "Verified via WhatsApp screenshot from donor with matching timestamp",
      }),
    });

    expect(matchRes.status).toBe(200);
    const matchBody = await matchRes.json();
    expect(matchBody).toMatchObject({
      status: "matched",
      bankTransactionId: targetCredit.id,
      pledgeId: pledge1.donationId,
      amountPaise: "200000",
    });

    // 3. Attempting to match the already-matched transaction or pledge again fails with 409 conflict
    const conflictRes = await app.request(`/v1/funds/${fundId}/reconciliation/manual-match`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-2" },
      body: JSON.stringify({
        bankTransactionId: targetCredit.id,
        pledgeId: pledge1.donationId,
        reason: "Duplicate match attempt",
      }),
    });
    expect(conflictRes.status).toBe(409);

    // 4. Amount mismatch is rejected with 400 validation error
    const otherPledge = await pledgeDonation(
      app,
      fundId,
      "50000",
      "888777666555",
      "Different Amount Donor",
    );
    const otherCredit = unmatched2000[1]; // 200000 paise
    expect(otherCredit).toBeDefined();
    if (!otherCredit) throw new Error("Expected otherCredit to exist");

    const mismatchRes = await app.request(`/v1/funds/${fundId}/reconciliation/manual-match`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-3" },
      body: JSON.stringify({
        bankTransactionId: otherCredit.id,
        pledgeId: otherPledge.donationId,
        reason: "Testing amount mismatch",
      }),
    });
    expect(mismatchRes.status).toBe(400);

    // 5. Non-existent IDs return 404
    const notFoundRes = await app.request(`/v1/funds/${fundId}/reconciliation/manual-match`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "manual-4" },
      body: JSON.stringify({
        bankTransactionId: "00000000-0000-4000-8000-000000999999",
        pledgeId: otherPledge.donationId,
        reason: "Testing not found",
      }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it("handles out-of-order ingestion: bank statement first, pledge later", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    const iciciCsv = await readFile(
      new URL("./fixtures/sandbox-icici-statement.csv", import.meta.url),
      "utf8",
    );

    // 1. Ingest statement FIRST (no pledges exist yet in this fund)
    const uploadRes = await app.request("/v1/reconciliation/statements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fundId, csvContent: iciciCsv }),
    });

    expect(uploadRes.status).toBe(200);
    const result = statementUploadResultSchema.parse(await uploadRes.json());
    expect(result.ingestedCount).toBe(3);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(2); // Two credits in icici csv

    // Unmatched queue has the 75000 paise credit
    const beforeQueue = unmatchedCreditsSchema.parse(
      await (await app.request(`/v1/funds/${fundId}/reconciliation/unmatched`)).json(),
    );
    expect(beforeQueue.some((item) => item.utr === "678901234567")).toBe(true);

    // 2. Donor submits matching pledge later (out of order)
    await pledgeDonation(app, fundId, "75000", "678901234567", "Late Donor");

    // 3. Queue now no longer contains the matched 75000 credit!
    const afterQueue = unmatchedCreditsSchema.parse(
      await (await app.request(`/v1/funds/${fundId}/reconciliation/unmatched`)).json(),
    );
    expect(afterQueue.some((item) => item.utr === "678901234567")).toBe(false);
  });

  it("enforces authentication and policy on reconciliation endpoints", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    // Unauthenticated request to unmatched queue returns 401
    const unauthedApp = createApp({
      principal: null,
      policy: devPolicy,
      logger: { log: () => undefined },
    });
    const unauthedRes = await unauthedApp.request(`/v1/funds/${fundId}/reconciliation/unmatched`);
    expect(unauthedRes.status).toBe(401);

    // Non-owner treasurer request returns 404 (concealing existence per devPolicy)
    const unauthorizedApp = createApp({
      principal: otherPrincipal,
      policy: devPolicy,
      logger: { log: () => undefined },
    });
    const unauthzRes = await unauthorizedApp.request(
      `/v1/funds/${fundId}/reconciliation/unmatched`,
    );
    expect(unauthzRes.status).toBe(404);
  });
});
