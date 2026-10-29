import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { createApp } from "../app.js";
import { statementUploadResultSchema, unmatchedCreditsSchema } from "../contract.js";
import type { AppDependencies } from "../dependencies.js";
import { devPolicy } from "../policy.js";
import { MemoryReconciliationStore } from "./memory-store.js";
import { signPartnerWebhook } from "./webhook-signature.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };
const otherPrincipal = { id: "00000000-0000-4000-8000-000000000002" };

const partnerSecret = "0".repeat(32);
const webhookPath = "/v1/reconciliation/webhooks/partner";

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
    partnerWebhookSecret: partnerSecret,
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

function signedWebhook(
  nowMs: number,
  body: string,
  signedAtSeconds = Math.floor(nowMs / 1000),
): {
  method: string;
  headers: { "x-webhook-timestamp": string; "x-webhook-signature": string } & Record<
    string,
    string
  >;
  body: string;
} {
  const timestamp = String(signedAtSeconds);
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signPartnerWebhook(
        partnerSecret,
        timestamp,
        new TextEncoder().encode(body),
      ),
    },
    body,
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
      unmatchedCount: 4, // Three unmatched credits and one unapproved debit
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
    const { app, now } = setup();
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
    const firstRes = await app.request(
      webhookPath,
      signedWebhook(now(), JSON.stringify(webhookPayload)),
    );

    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody).toMatchObject({
      status: "processed",
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
      duplicate: false,
    });

    // Replay identical webhook (idempotent receiver)
    const secondRes = await app.request(
      webhookPath,
      signedWebhook(now(), JSON.stringify(webhookPayload)),
    );

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
    expect(result.unmatchedCount).toBe(3); // Two unmatched credits and one unapproved debit

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

describe("Partner webhook authentication", () => {
  const utr = "998877665544";

  function webhookPayload(fundId: string, overrides: Record<string, unknown> = {}) {
    return {
      event: "virtual_account.credited",
      timestamp: "2026-10-28T11:59:00.000Z",
      data: {
        fund_id: fundId,
        bank_reference: "PAY_PARTNER_AUTH_001",
        amount_paise: 75000,
        type: "credit",
        posted_at: "2026-10-28T11:58:00.000Z",
        utr,
        narration: `UPI/CR/${utr}/DONATION`,
        ...overrides,
      },
    };
  }

  async function arrange(overrides: Partial<AppDependencies> = {}) {
    const store = new MemoryReconciliationStore();
    const ingest = vi.spyOn(store, "ingest");
    const harness = setup({ reconciliationStore: store, ...overrides });
    const fundId = await createFund(harness.app);
    const pledge = await pledgeDonation(harness.app, fundId, "75000", utr, "Webhook Donor");
    const body = JSON.stringify(webhookPayload(fundId));
    return { ...harness, fundId, pledge, body, ingest };
  }

  async function expectUnauthenticated(response: Response) {
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  }

  it("rejects an unsigned webhook without touching the ledger", async () => {
    const { app, body, ingest } = await arrange();
    for (const path of [webhookPath, `${webhookPath}/`]) {
      await expectUnauthenticated(
        await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a request missing either the signature or the timestamp", async () => {
    const { app, body, now, ingest } = await arrange();
    const signed = signedWebhook(now(), body);
    for (const header of ["x-webhook-signature", "x-webhook-timestamp"]) {
      const { [header]: _removed, ...headers } = signed.headers;
      await expectUnauthenticated(await app.request(webhookPath, { ...signed, headers }));
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("authenticates before parsing so unsigned malformed JSON is 401 and not 400", async () => {
    const { app, ingest } = await arrange();
    await expectUnauthenticated(
      await app.request(webhookPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects any modification of the signed bytes", async () => {
    const { app, fundId, body, now, ingest } = await arrange();
    const signed = signedWebhook(now(), body);
    const tampered = [
      body.replace('"amount_paise":75000', '"amount_paise":75001'),
      body.replace("PAY_PARTNER_AUTH_001", "PAY_PARTNER_AUTH_002"),
      JSON.stringify(webhookPayload(fundId), null, 2),
      `${body}\n`,
      ` ${body}`,
    ];
    for (const changed of tampered) {
      expect(changed).not.toBe(body);
      await expectUnauthenticated(await app.request(webhookPath, { ...signed, body: changed }));
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects stale and future timestamps even when correctly signed", async () => {
    const { app, body, now, ingest } = await arrange();
    const nowSeconds = Math.floor(now() / 1000);
    for (const skew of [-301, 301, -86_400, 86_400]) {
      await expectUnauthenticated(
        await app.request(webhookPath, signedWebhook(now(), body, nowSeconds + skew)),
      );
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a timestamp changed after signing, including a refreshed replay", async () => {
    const { app, body, now, advance, ingest } = await arrange();
    const original = signedWebhook(now(), body);
    advance(10 * 60 * 1000);
    const refreshedSeconds = String(Math.floor(now() / 1000));
    await expectUnauthenticated(
      await app.request(webhookPath, {
        ...original,
        headers: { ...original.headers, "x-webhook-timestamp": refreshedSeconds },
      }),
    );
    await expectUnauthenticated(await app.request(webhookPath, original));
    const nudged = String(Number(original.headers["x-webhook-timestamp"]) + 1);
    await expectUnauthenticated(
      await app.request(webhookPath, {
        ...original,
        headers: { ...original.headers, "x-webhook-timestamp": nudged },
      }),
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects wrong-secret, malformed, and non-canonical credentials", async () => {
    const { app, body, now, ingest } = await arrange();
    const signed = signedWebhook(now(), body);
    const timestamp = signed.headers["x-webhook-timestamp"];
    const signature = signed.headers["x-webhook-signature"];
    const forged = signPartnerWebhook(
      "another-partner-secret-with-32-characters",
      timestamp,
      new TextEncoder().encode(body),
    );
    const headerVariants = [
      { "x-webhook-signature": forged },
      { "x-webhook-signature": signature.toUpperCase() },
      { "x-webhook-signature": signature.slice(0, 62) },
      { "x-webhook-signature": `sha256=${signature}` },
      { "x-webhook-signature": "" },
      { "x-webhook-timestamp": `0${timestamp}` },
      { "x-webhook-timestamp": `${timestamp}.0` },
      { "x-webhook-timestamp": new Date(now()).toISOString() },
    ];
    for (const variant of headerVariants) {
      await expectUnauthenticated(
        await app.request(webhookPath, { ...signed, headers: { ...signed.headers, ...variant } }),
      );
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("fails closed when no partner secret is configured", async () => {
    const { app, body, now, ingest } = await arrange({ partnerWebhookSecret: null });
    await expectUnauthenticated(await app.request(webhookPath, signedWebhook(now(), body)));
    const emptySecretSignature = signPartnerWebhook(
      "",
      String(Math.floor(now() / 1000)),
      new TextEncoder().encode(body),
    );
    const unsigned = signedWebhook(now(), body);
    await expectUnauthenticated(
      await app.request(webhookPath, {
        ...unsigned,
        headers: { ...unsigned.headers, "x-webhook-signature": emptySecretSignature },
      }),
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed webhook inside the tolerance and reconciles the pledge", async () => {
    const { app, body, pledge, now, ingest } = await arrange();
    const nowSeconds = Math.floor(now() / 1000);
    const response = await app.request(webhookPath, signedWebhook(now(), body, nowSeconds - 300));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "processed",
      duplicate: false,
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    const [transactions] = ingest.mock.calls[0] ?? [];
    expect(transactions).toHaveLength(1);
    expect(transactions?.[0]).toMatchObject({
      source: "webhook_partner",
      amountPaise: 75000,
      utr,
    });
  });

  it("accepts a signed webhook with a future timestamp inside the tolerance", async () => {
    const { app, body, now } = await arrange();
    const response = await app.request(
      webhookPath,
      signedWebhook(now(), body, Math.floor(now() / 1000) + 300),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for signed but malformed payloads without ingesting them", async () => {
    const { app, fundId, now, ingest } = await arrange();
    const cases: string[] = [
      "{not json",
      "",
      "[]",
      "null",
      JSON.stringify({ ...webhookPayload(fundId), unexpected: true }),
      JSON.stringify(webhookPayload(fundId, { fund_id: "not-a-uuid" })),
      JSON.stringify(webhookPayload(fundId, { amount_paise: -5 })),
      JSON.stringify(webhookPayload(fundId, { amount_paise: 0 })),
      JSON.stringify(webhookPayload(fundId, { amount_paise: 500.5 })),
      JSON.stringify(webhookPayload(fundId, { amount_paise: "12.50" })),
      JSON.stringify(webhookPayload(fundId, { amount_paise: "99999999999999999999" })),
      JSON.stringify(webhookPayload(fundId, { utr: "123" })),
      JSON.stringify(webhookPayload(fundId, { posted_at: "yesterday" })),
    ];
    for (const body of cases) {
      const response = await app.request(webhookPath, signedWebhook(now(), body));
      expect(response.status, body).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("treats a replay of a signed request as idempotent and rejects it once stale", async () => {
    const { app, body, pledge, now, advance, ingest } = await arrange();
    const request = signedWebhook(now(), body);

    const first = await app.request(webhookPath, request);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ duplicate: false, matchedPledgeId: pledge.donationId });

    advance(60_000);
    const replay = await app.request(webhookPath, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      duplicate: true,
      transactionId: (firstBody as { transactionId: string }).transactionId,
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
    });

    const lastResults = await Promise.all(ingest.mock.results.map((result) => result.value));
    expect(lastResults.map((result) => result.ingestedCount)).toEqual([1, 0]);
    expect(lastResults.map((result) => result.duplicateCount)).toEqual([0, 1]);

    advance(5 * 60 * 1000);
    await expectUnauthenticated(await app.request(webhookPath, request));
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("does not let a rejected forgery block the genuine signed delivery", async () => {
    const { app, fundId, body, pledge, now, ingest } = await arrange();
    const forged = JSON.stringify(
      webhookPayload(fundId, { bank_reference: "PAY_PARTNER_AUTH_001" }),
    );
    await expectUnauthenticated(
      await app.request(webhookPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: forged,
      }),
    );
    expect(ingest).not.toHaveBeenCalled();

    const genuine = await app.request(webhookPath, signedWebhook(now(), body));
    expect(genuine.status).toBe(200);
    expect(await genuine.json()).toMatchObject({
      duplicate: false,
      reconciliationStatus: "matched",
      matchedPledgeId: pledge.donationId,
    });
  });
});
