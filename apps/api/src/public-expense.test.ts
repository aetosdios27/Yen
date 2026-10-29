import crypto from "node:crypto";
import { type ExpenseRequest, InMemoryExpenseStore } from "@yen/ledger";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppDependencies, Principal } from "./dependencies.js";
import { MemoryFundStore } from "./dependencies.js";
import { devPolicy } from "./policy.js";
import { MemoryStorageAdapter } from "./storage.js";
import { MemoryEvidenceStore, type StoredEvidence } from "./stores.js";

const fundId = "00000000-0000-4000-8000-000000000010";
const expenseId = "00000000-0000-4000-8000-000000000020";
const owner: Principal = { id: "00000000-0000-4000-8000-000000000001", role: "owner" };
const donor: Principal = { id: "00000000-0000-4000-8000-000000000002", role: "donor" };
const member: Principal = { id: "00000000-0000-4000-8000-000000000003", role: "member" };
const unknownFundId = "00000000-0000-4000-8000-000000000012";
const sharedRequestId = "00000000-0000-4000-8000-000000000099";

const sensitiveValues = {
  phone: "+919876543210",
  vpa: "privatecommittee@yenbank",
  utr: "ABCDEF123456789",
  fullName: "Sensitive Person",
  bankAccount: "1234567890123456",
};

function createFixture() {
  const expense = {
    id: expenseId,
    fundId,
    requesterId: "psn_00000000-0000-4000-8000-000000000021" as ExpenseRequest["requesterId"],
    amountPaise: 2500,
    description: `Paid by ${sensitiveValues.fullName}; phone ${sensitiveValues.phone}; UTR ${sensitiveValues.utr}; ${sensitiveValues.vpa}; account ${sensitiveValues.bankAccount}`,
    recipientRef: sensitiveValues.vpa,
    status: "paid",
    holdId: null,
    approvals: [],
    evidence: [],
    supersedesId: null,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    submittedAt: "2026-10-28T00:00:00.000Z",
    objectionEndsAt: null,
    approvedAt: "2026-10-28T00:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: "2026-10-28T00:00:00.000Z",
    reconciledAt: null,
    bankTransactionId: sensitiveValues.utr,
    expiresAt: null,
    phone: sensitiveValues.phone,
    utr: sensitiveValues.utr,
    payeeAccount: sensitiveValues.bankAccount,
    requesterDisplayName: sensitiveValues.fullName,
    fraudFlags: [{ code: "self_payment", reason: "Private payee profile match." }],
    fraudAcknowledgements: [
      {
        code: "self_payment",
        actorPseudonym: "psn_00000000-0000-4000-8000-000000000022",
        reason: "Private owner review.",
        acknowledgedAt: "2026-10-28T00:00:00.000Z",
      },
    ],
  } as unknown as ExpenseRequest;
  const underlyingExpenseStore = new InMemoryExpenseStore();
  const expenseStore = {
    ...underlyingExpenseStore,
    get: async (id: string) => (id === expenseId ? expense : underlyingExpenseStore.get(id)),
    list: async (id: string) => (id === fundId ? [expense] : underlyingExpenseStore.list(id)),
    save: underlyingExpenseStore.save.bind(underlyingExpenseStore),
    atomicApprove: underlyingExpenseStore.atomicApprove.bind(underlyingExpenseStore),
  } as AppDependencies["expenseStore"];
  const fundStore = new MemoryFundStore();
  const evidenceStore = new MemoryEvidenceStore();
  const storageAdapter = new MemoryStorageAdapter();
  const bytes = Buffer.from("verified bill image content");
  const evidenceId = "00000000-0000-4000-8000-000000000030";
  const objectKey = "internal/evidence/object-30";
  const evidence: StoredEvidence = {
    evidenceId,
    fundId,
    expenseId,
    fileSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf",
    fileSizeBytes: bytes.length,
    fileName: `private-${sensitiveValues.phone}.pdf`,
    objectKey,
    duplicateDetected: false,
    isDuplicate: false,
    vendorName: "Reliable Supplies Ltd",
    gstin: "27AAPFU0939F1ZV",
    invoiceNumber: sensitiveValues.utr,
    invoiceDate: "2026-10-28",
    createdAt: "2026-10-28T00:00:00.000Z",
    scan: {
      scannerName: "fixture-scanner",
      signatureVersion: "fixture-version",
      result: "clean",
    },
  };
  return {
    expense,
    fundStore,
    expenseStore,
    evidenceStore,
    storageAdapter,
    bytes,
    evidence,
    async initialize() {
      await storageAdapter.putObject(objectKey, bytes, evidence.mimeType);
      await evidenceStore.save(evidence);
    },
    app(principal: Principal | null) {
      return createApp({
        principal,
        idGenerator: () => fundId,
        policy: devPolicy,
        fundStore,
        expenseStore,
        evidenceStore,
        storageAdapter,
      });
    },
  };
}

async function createFund(app: ReturnType<typeof createApp>, visibility: string) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": `create-${visibility}` },
    body: JSON.stringify({
      name: "Community fund",
      purpose: `Contact ${sensitiveValues.fullName} at ${sensitiveValues.phone}; ${sensitiveValues.utr}; ${sensitiveValues.vpa}; account ${sensitiveValues.bankAccount}`,
      visibility,
      targetPaise: "9000",
      upiVpa: sensitiveValues.vpa,
      upiPayeeName: "Committee",
    }),
  });
  expect(response.status).toBe(201);
}

async function publicFundFixture(visibility = "public") {
  const fixture = createFixture();
  await fixture.initialize();
  await createFund(fixture.app(owner), visibility);
  return fixture;
}

describe("public expense details and proofs", () => {
  it("returns only tier-redacted metadata to anonymous viewers", async () => {
    const fixture = await publicFundFixture();
    const app = fixture.app(null);
    const detail = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}`);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("cache-control")).toContain("public");
    const detailBytes = new TextDecoder().decode(await detail.arrayBuffer());
    expect(detailBytes).not.toContain("Reliable Supplies Ltd");
    expect(detailBytes).not.toMatch(
      /self_payment|Private payee profile match|Private owner review/,
    );

    const getObject = vi.spyOn(fixture.storageAdapter, "getObject");
    const proofs = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}/proofs`);
    expect(proofs.status).toBe(200);
    expect(proofs.headers.get("cache-control")).toContain("public");
    expect(proofs.headers.get("content-disposition")).toContain("attachment");
    expect(proofs.headers.get("x-content-type-options")).toBe("nosniff");
    expect(proofs.headers.get("content-security-policy")).toContain("sandbox");
    expect(getObject).not.toHaveBeenCalled();
    const proofBytes = new TextDecoder().decode(await proofs.arrayBuffer());
    expect(proofBytes).toContain(fixture.evidence.fileSha256);
    expect(proofBytes).toContain('"scanStatus":"clean"');
    expect(proofBytes).not.toMatch(/contentBase64|mimeType|fileName|Reliable Supplies Ltd/);
  });

  it("returns full payee names and verified bill bytes to donors", async () => {
    const fixture = await publicFundFixture();
    const app = fixture.app(donor);
    const detail = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ payeeName: "Reliable Supplies Ltd" });
    expect(detail.headers.get("cache-control")).toBe("private, no-store");

    const proofs = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}/proofs`);
    const body = (await proofs.json()) as {
      proofs: Array<{ contentBase64: string; fileName?: string; mimeType: string }>;
    };
    expect(proofs.status).toBe(200);
    expect(body.proofs[0]?.contentBase64).toBe(fixture.bytes.toString("base64"));
    expect(body.proofs[0]?.mimeType).toBe("application/pdf");
    expect(body.proofs[0]).not.toHaveProperty("fileName");
  });

  it("lets members read member-tier files while structured bank fields stay excluded", async () => {
    const fixture = await publicFundFixture("members");
    const app = fixture.app(member);
    const detail = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}`);
    expect(detail.status).toBe(200);
    const detailText = await detail.text();
    expect(detailText).toContain("Reliable Supplies Ltd");
    expect(detailText).not.toContain(sensitiveValues.phone);
    expect(detailText).not.toContain(sensitiveValues.utr);
    expect(detailText).not.toContain(sensitiveValues.vpa);
    expect(detailText).not.toContain(sensitiveValues.bankAccount);

    const proofs = await app.request(`/v1/funds/${fundId}/public/expenses/${expenseId}/proofs`);
    expect(proofs.status).toBe(200);
    expect(await proofs.text()).toContain(fixture.bytes.toString("base64"));

    const donorResponse = await fixture
      .app(donor)
      .request(`/v1/funds/${fundId}/public/expenses/${expenseId}`);
    expect(donorResponse.status).toBe(404);
  });

  it("crawls every public fund read endpoint and checks response bytes for fixture secrets", async () => {
    const fixture = await publicFundFixture();
    const app = fixture.app(null);
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });
    const publicGetPaths = Object.entries(document.paths ?? {}).flatMap(([path, methods]) =>
      path.includes("/public/") && methods?.get ? [path] : [],
    );
    expect(publicGetPaths).toHaveLength(6);

    for (const path of publicGetPaths) {
      const url = path.replaceAll("{fundId}", fundId).replaceAll("{expenseId}", expenseId);
      const response = await app.request(url);
      expect(response.status, path).toBe(200);
      const responseBytes = new Uint8Array(await response.arrayBuffer());
      const responseText = new TextDecoder().decode(responseBytes);
      for (const secret of Object.values(sensitiveValues)) {
        expect(responseText, `${path} leaked a fixture secret`).not.toContain(secret);
      }
    }
  });

  it("makes private and unknown funds share a 404 response, headers, and timing floor", async () => {
    const fixture = await publicFundFixture("private");
    const app = fixture.app(null);
    const request = (id: string) =>
      app.request(`/v1/funds/${id}/public/summary`, {
        headers: { "x-request-id": sharedRequestId },
      });

    const privateStarted = performance.now();
    const privateResponse = await request(fundId);
    const privateElapsed = performance.now() - privateStarted;
    const privateBody = await privateResponse.text();

    const unknownStarted = performance.now();
    const unknownResponse = await request(unknownFundId);
    const unknownElapsed = performance.now() - unknownStarted;
    const unknownBody = await unknownResponse.text();

    expect(privateResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    expect(unknownBody).toBe(privateBody);
    expect(Array.from(unknownResponse.headers.entries())).toEqual(
      Array.from(privateResponse.headers.entries()),
    );
    expect(privateElapsed).toBeGreaterThanOrEqual(45);
    expect(unknownElapsed).toBeGreaterThanOrEqual(45);
  });

  it("does not publish a fund collection listing", async () => {
    const fixture = await publicFundFixture();
    const app = fixture.app(null);
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });
    expect(document.paths?.["/v1/funds"]?.get).toBeUndefined();
    const response = await app.request("/v1/funds");
    expect(response.status).not.toBe(200);
  });
});
