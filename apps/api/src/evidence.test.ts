import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { devPolicy } from "./policy.js";
import type { StoredEvidence } from "./stores.js";

const FUND_OWNER = { id: "00000000-0000-4000-8000-000000000001" };
const EXPENSE_ID_1 = "00000000-0000-4000-8000-000000000011";
const EXPENSE_ID_2 = "00000000-0000-4000-8000-000000000022";

function createTestApp(options: { clock?: number; loggedEntries?: unknown[] } = {}) {
  const loggedEntries: unknown[] = options.loggedEntries ?? [];
  let seq = 1;
  const app = createApp({
    principal: FUND_OWNER,
    idGenerator: () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
    clock: () => options.clock ?? 1700000000000,
    policy: devPolicy,
    logger: {
      log: (entry) => {
        loggedEntries.push(entry);
      },
    },
  });
  return { app, loggedEntries };
}

async function createTestFund(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/funds", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `fund-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ name: "Solar Initiative", targetPaise: "500000" }),
  });
  expect(res.status).toBe(201);
  const fund = (await res.json()) as { id: string };
  return fund.id;
}

describe("Evidence Upload API Endpoint", () => {
  it("uploads an evidence bill and computes server-side cryptographic SHA-256", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const expectedSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");

    const fd = new FormData();
    fd.append("file", new File([fileBytes], "invoice.pdf", { type: "application/pdf" }));
    fd.append("vendorName", "Solar Corp");
    fd.append("gstin", "27AAPFU0939F1ZV");
    fd.append("invoiceNumber", "INV-2026-001");
    fd.append("invoiceDate", "2026-10-28");

    const res = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as StoredEvidence;

    expect(body.evidenceId).toBeDefined();
    expect(body.fundId).toBe(fundId);
    expect(body.expenseId).toBe(EXPENSE_ID_1);
    expect(body.fileSha256).toBe(expectedSha256);
    expect(body.mimeType).toBe("application/pdf");
    expect(body.fileSizeBytes).toBe(fileBytes.length);
    expect(body.vendorName).toBe("Solar Corp");
    expect(body.gstin).toBe("27AAPFU0939F1ZV");
    expect(body.invoiceNumber).toBe("INV-2026-001");
    expect(body.invoiceDate).toBe("2026-10-28");
    expect(body.duplicateDetected).toBe(false);
    expect(body.isDuplicate).toBe(false);
    expect(body.duplicateExpenseId).toBeUndefined();
  });

  it("accepts all allowed MIME types (JPEG, PNG, WebP, PDF)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const mimeTestCases = [
      { name: "test.jpg", type: "image/jpeg" },
      { name: "test.png", type: "image/png" },
      { name: "test.webp", type: "image/webp" },
      { name: "test.pdf", type: "application/pdf" },
    ] as const;

    for (const { name, type } of mimeTestCases) {
      const fd = new FormData();
      fd.append("file", new File([new Uint8Array([1, 2, 3])], name, { type }));
      const res = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
        method: "POST",
        body: fd,
      });
      expect(res.status, `MIME type ${type} should be accepted`).toBe(201);
      const data = (await res.json()) as StoredEvidence;
      expect(data.mimeType).toBe(type);
    }
  });

  it("rejects unsupported MIME types with validation_failed (400)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append("file", new File(["plain text bill"], "bill.txt", { type: "text/plain" }));

    const res = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: Array<{ message: string }> };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.message).toContain("Allowed MIME types");
  });

  it("validates Indian GSTIN using format regex and modulo 36 checksum", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    // Corrupted checksum: 'O' instead of 'V'
    const fdBadGstin = new FormData();
    fdBadGstin.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "receipt.pdf", { type: "application/pdf" }),
    );
    fdBadGstin.append("gstin", "27AAPFU0939F1ZO");

    const resBad = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fdBadGstin,
    });

    expect(resBad.status).toBe(400);
    const bodyBad = (await resBad.json()) as {
      error: { code: string; details?: Array<{ message: string }> };
    };
    expect(bodyBad.error.code).toBe("validation_failed");
    expect(bodyBad.error.details?.[0]?.message).toContain("checksum");

    // Correct checksum: 'V'
    const fdGoodGstin = new FormData();
    fdGoodGstin.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "receipt.pdf", { type: "application/pdf" }),
    );
    fdGoodGstin.append("gstin", "27AAPFU0939F1ZV");

    const resGood = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fdGoodGstin,
    });
    expect(resGood.status).toBe(201);
  });

  it("rejects files exceeding the 10MB limit with payload_too_large (413)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1); // 10MB + 1 byte
    const fd = new FormData();
    fd.append("file", new File([oversizedBytes], "big.pdf", { type: "application/pdf" }));

    const res = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd,
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });

  it("detects and flags duplicate evidence attached to a different expense", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const identicalFileBytes = new Uint8Array([42, 43, 44, 45, 46]);

    // First upload to expense 1
    const fd1 = new FormData();
    fd1.append("file", new File([identicalFileBytes], "bill1.pdf", { type: "application/pdf" }));
    const res1 = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd1,
    });
    expect(res1.status).toBe(201);
    const data1 = (await res1.json()) as StoredEvidence;
    expect(data1.duplicateDetected).toBe(false);
    expect(data1.isDuplicate).toBe(false);

    // Re-upload identical file to the SAME expense (not a different expense)
    const fdSame = new FormData();
    fdSame.append(
      "file",
      new File([identicalFileBytes], "bill1_copy.pdf", { type: "application/pdf" }),
    );
    const resSame = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fdSame,
    });
    expect(resSame.status).toBe(201);
    const dataSame = (await resSame.json()) as StoredEvidence;
    expect(dataSame.duplicateDetected).toBe(false);
    expect(dataSame.isDuplicate).toBe(false);

    // Upload identical file to a DIFFERENT expense
    const fd2 = new FormData();
    fd2.append("file", new File([identicalFileBytes], "bill2.pdf", { type: "application/pdf" }));
    const res2 = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_2}/evidence`, {
      method: "POST",
      body: fd2,
    });
    expect(res2.status).toBe(201);
    const data2 = (await res2.json()) as StoredEvidence;
    expect(data2.duplicateDetected).toBe(true);
    expect(data2.isDuplicate).toBe(true);
    expect(data2.duplicateExpenseId).toBe(EXPENSE_ID_1);
  });

  it("retrieves evidence list for an expense via GET endpoint", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fd1 = new FormData();
    fd1.append("file", new File([new Uint8Array([1, 1, 1])], "part1.jpg", { type: "image/jpeg" }));
    fd1.append("vendorName", "Merchant A");

    const fd2 = new FormData();
    fd2.append("file", new File([new Uint8Array([2, 2, 2])], "part2.png", { type: "image/png" }));
    fd2.append("vendorName", "Merchant B");

    await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd1,
    });
    await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd2,
    });

    const getRes = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`);
    expect(getRes.status).toBe(200);
    const list = (await getRes.json()) as { evidence: StoredEvidence[] };
    expect(list.evidence).toHaveLength(2);
    expect(list.evidence[0]?.vendorName).toBe("Merchant A");
    expect(list.evidence[1]?.vendorName).toBe("Merchant B");
  });

  it("strictly omits PII and sensitive evidence fields from event logs", async () => {
    const loggedEntries: Array<Record<string, unknown>> = [];
    const { app } = createTestApp({ loggedEntries });
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append(
      "file",
      new File([new Uint8Array([10, 20])], "confidential_bill.pdf", { type: "application/pdf" }),
    );
    fd.append("vendorName", "Secret Vendor PII");
    fd.append("gstin", "27AAPFU0939F1ZV");
    fd.append("invoiceNumber", "CONFIDENTIAL-INV-99");

    const res = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(201);

    // Verify all logger events produced
    for (const entry of loggedEntries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain("Secret Vendor PII");
      expect(serialized).not.toContain("27AAPFU0939F1ZV");
      expect(serialized).not.toContain("CONFIDENTIAL-INV-99");
      expect(serialized).not.toContain("confidential_bill.pdf");
    }
  });

  it("enforces authentication and authorization access control", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1])], "b.pdf", { type: "application/pdf" }));

    // Unauthenticated
    const unauthApp = createApp({ principal: null, policy: devPolicy });
    const resUnauth = await unauthApp.request(
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      { method: "POST", body: fd },
    );
    expect(resUnauth.status).toBe(401);

    // Non-owner / policy denial
    const forbiddenApp = createApp({
      principal: FUND_OWNER,
      policy: {
        can: (_principal, action) => {
          if (action === "fund:create") return true;
          return false;
        },
        redact: devPolicy.redact,
      },
    });
    const forbiddenFundId = await createTestFund(forbiddenApp);
    const resForbidden = await forbiddenApp.request(
      `/v1/funds/${forbiddenFundId}/expenses/${EXPENSE_ID_1}/evidence`,
      { method: "POST", body: fd },
    );
    expect(resForbidden.status).toBe(403);

    // Unknown fund ID
    const resMissing = await app.request(
      "/v1/funds/00000000-0000-4000-8000-999999999999/expenses/00000000-0000-4000-8000-000000000011/evidence",
      { method: "POST", body: fd },
    );
    expect(resMissing.status).toBe(404);
  });
});
