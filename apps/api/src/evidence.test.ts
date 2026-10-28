import crypto from "node:crypto";
import type { AppendEventInput, StoredFundEvent } from "@yen/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { checkEvidenceIntegrity, runEvidenceIntegrityJob } from "./integrity-job.js";
import { devPolicy } from "./policy.js";
import { MemoryStorageAdapter } from "./storage.js";
import { MemoryEvidenceStore, type StoredEvidence } from "./stores.js";
import { MemoryVirusScannerAdapter } from "./test-utils/memory-virus-scanner.js";

const FUND_OWNER = { id: "00000000-0000-4000-8000-000000000001" };
const EXPENSE_ID_1 = "00000000-0000-4000-8000-000000000011";
const EXPENSE_ID_2 = "00000000-0000-4000-8000-000000000022";

// Authentic binary signatures for permitted MIME types
const VALID_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const VALID_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const VALID_WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

async function evidenceRequest(
  app: ReturnType<typeof createApp>,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if ((init?.method ?? "GET").toUpperCase() === "POST") {
    headers.set("Idempotency-Key", `evidence-${crypto.randomUUID()}`);
  }
  return app.request(input, { ...init, headers });
}

function createTestApp(
  options: {
    clock?: number;
    loggedEntries?: unknown[];
    storageAdapter?: MemoryStorageAdapter;
    virusScanner?: MemoryVirusScannerAdapter;
    evidenceStore?: MemoryEvidenceStore;
    eventAppender?: ((input: AppendEventInput) => Promise<StoredFundEvent>) | undefined;
  } = {},
) {
  const loggedEntries: unknown[] = options.loggedEntries ?? [];
  let seq = 1;
  const storageAdapter = options.storageAdapter ?? new MemoryStorageAdapter();
  const virusScanner = options.virusScanner ?? new MemoryVirusScannerAdapter();
  const evidenceStore = options.evidenceStore ?? new MemoryEvidenceStore();
  const app = createApp({
    principal: FUND_OWNER,
    idGenerator: () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
    clock: () => options.clock ?? 1700000000000,
    policy: devPolicy,
    storageAdapter,
    virusScanner,
    evidenceStore,
    eventAppender: options.eventAppender,
    logger: {
      log: (entry) => {
        loggedEntries.push(entry);
      },
    },
  });
  return { app, loggedEntries, storageAdapter, virusScanner, evidenceStore };
}

async function createTestFund(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/funds", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `fund-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      name: "Solar Initiative",
      targetPaise: "500000",
      upiVpa: "solar@yenbank",
      upiPayeeName: "Solar Initiative",
    }),
  });
  expect(res.status).toBe(201);
  const fund = (await res.json()) as { id: string };
  return fund.id;
}

describe("Evidence Upload API Endpoint", () => {
  it("rejects uploads when the default app has no malware scanner configured", async () => {
    const app = createApp({ principal: FUND_OWNER, policy: devPolicy });
    const fundId = await createTestFund(app);
    const form = new FormData();
    form.append("file", new File([VALID_PDF_BYTES], "invoice.pdf", { type: "application/pdf" }));

    const response = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      { method: "POST", body: form },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
  });

  it("uploads an evidence bill and computes server-side cryptographic SHA-256", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fileBytes = VALID_PDF_BYTES;
    const expectedSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");

    const fd = new FormData();
    fd.append("file", new File([fileBytes], "invoice.pdf", { type: "application/pdf" }));
    fd.append("vendorName", "Solar Corp");
    fd.append("gstin", "27AAPFU0939F1ZV");
    fd.append("invoiceNumber", "INV-2026-001");
    fd.append("invoiceDate", "2026-10-28");

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );

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

  it("accepts all allowed MIME types (JPEG, PNG, WebP, PDF) with matching binary magic bytes", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const mimeTestCases = [
      { name: "test.jpg", type: "image/jpeg", bytes: VALID_JPEG_BYTES },
      { name: "test.png", type: "image/png", bytes: VALID_PNG_BYTES },
      { name: "test.webp", type: "image/webp", bytes: VALID_WEBP_BYTES },
      { name: "test.pdf", type: "application/pdf", bytes: VALID_PDF_BYTES },
    ] as const;

    for (const { name, type, bytes } of mimeTestCases) {
      const fd = new FormData();
      fd.append("file", new File([bytes], name, { type }));
      const res = await evidenceRequest(
        app,
        `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
        {
          method: "POST",
          body: fd,
        },
      );
      expect(res.status, `MIME type ${type} should be accepted`).toBe(201);
      const data = (await res.json()) as StoredEvidence;
      expect(data.mimeType).toBe(type);
    }
  });

  it("rejects files whose binary magic bytes do not match declared MIME type (magic byte spoofing)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    // Text file pretending to be image/jpeg
    const fakeJpeg = new TextEncoder().encode(
      "<html><body>Malicious HTML disguised as JPEG</body></html>",
    );
    const fd = new FormData();
    fd.append("file", new File([fakeJpeg], "exploit.jpg", { type: "image/jpeg" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: Array<{ message: string }> };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.message).toContain("binary signature");
  });

  it("rejects unsupported MIME types with validation_failed (400)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append("file", new File(["plain text bill"], "bill.txt", { type: "text/plain" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );

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
      new File([VALID_PDF_BYTES], "receipt.pdf", { type: "application/pdf" }),
    );
    fdBadGstin.append("gstin", "27AAPFU0939F1ZO");

    const resBad = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fdBadGstin,
      },
    );

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
      new File([VALID_PDF_BYTES], "receipt.pdf", { type: "application/pdf" }),
    );
    fdGoodGstin.append("gstin", "27AAPFU0939F1ZV");

    const resGood = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fdGoodGstin,
      },
    );
    expect(resGood.status).toBe(201);
  });

  it("rejects files exceeding the 10MB limit with payload_too_large (413)", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1); // 10MB + 1 byte
    const fd = new FormData();
    fd.append("file", new File([oversizedBytes], "big.pdf", { type: "application/pdf" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });

  it("stops reading an oversized request body at the streaming body limit", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);
    let pulledBytes = 0;
    let remainingBytes = 12 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(Math.min(65536, remainingBytes));
        pulledBytes += chunk.byteLength;
        remainingBytes -= chunk.byteLength;
        controller.enqueue(chunk);
        if (remainingBytes === 0) controller.close();
      },
    });
    const response = await app.request(`/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "Idempotency-Key": "streaming-size-limit",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(pulledBytes).toBeLessThanOrEqual(11 * 1024 * 1024);
  });

  it("fails closed when virus scanner detects infected file or test malware signature", async () => {
    const virusScanner = new MemoryVirusScannerAdapter();
    const { app } = createTestApp({ virusScanner });
    const fundId = await createTestFund(app);

    // EICAR standard test string with PDF header
    const eicarPrefix = new TextEncoder().encode(
      "%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const fd = new FormData();
    fd.append("file", new File([eicarPrefix], "infected.pdf", { type: "application/pdf" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: Array<{ message: string }> };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.message).toContain("Malicious file rejected");
  });

  it("detects and flags duplicate evidence attached to a different expense within the same fund", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const identicalFileBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x31,
    ]); // valid PDF bytes

    // First upload to expense 1
    const fd1 = new FormData();
    fd1.append("file", new File([identicalFileBytes], "bill1.pdf", { type: "application/pdf" }));
    const res1 = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd1,
      },
    );
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
    const resSame = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fdSame,
      },
    );
    expect(resSame.status).toBe(201);
    const dataSame = (await resSame.json()) as StoredEvidence;
    expect(dataSame.duplicateDetected).toBe(false);
    expect(dataSame.isDuplicate).toBe(false);

    // Upload identical file to a DIFFERENT expense within the same fund
    const fd2 = new FormData();
    fd2.append("file", new File([identicalFileBytes], "bill2.pdf", { type: "application/pdf" }));
    const res2 = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_2}/evidence`,
      {
        method: "POST",
        body: fd2,
      },
    );
    expect(res2.status).toBe(201);
    const data2 = (await res2.json()) as StoredEvidence;
    expect(data2.duplicateDetected).toBe(true);
    expect(data2.isDuplicate).toBe(true);
    expect(data2.duplicateExpenseId).toBe(EXPENSE_ID_1);
  });

  it("strictly enforces cross-fund isolation for duplicate detection without disclosure of other fund", async () => {
    const { app } = createTestApp();
    const fundA = await createTestFund(app);
    const fundB = await createTestFund(app);

    const identicalBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x99,
    ]);

    // Upload in Fund A
    const fdA = new FormData();
    fdA.append("file", new File([identicalBytes], "bill_a.pdf", { type: "application/pdf" }));
    const resA = await evidenceRequest(
      app,
      `/v1/funds/${fundA}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fdA,
      },
    );
    expect(resA.status).toBe(201);

    // Upload same identical bytes in Fund B - MUST NOT be flagged as duplicate, and MUST NOT reveal Fund A expense
    const fdB = new FormData();
    fdB.append("file", new File([identicalBytes], "bill_b.pdf", { type: "application/pdf" }));
    const resB = await evidenceRequest(
      app,
      `/v1/funds/${fundB}/expenses/${EXPENSE_ID_2}/evidence`,
      {
        method: "POST",
        body: fdB,
      },
    );
    expect(resB.status).toBe(201);
    const dataB = (await resB.json()) as StoredEvidence;
    expect(dataB.duplicateDetected).toBe(false);
    expect(dataB.isDuplicate).toBe(false);
    expect(dataB.duplicateExpenseId).toBeUndefined();
  });

  it("atomically records expense.evidence_added event via deps.eventAppender", async () => {
    const appendedEvents: unknown[] = [];
    const eventAppender = async (event: AppendEventInput): Promise<StoredFundEvent> => {
      appendedEvents.push(event);
      return { ...event, canonical_envelope: JSON.stringify(event) } as StoredFundEvent;
    };

    const { app } = createTestApp({ eventAppender });
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append("file", new File([VALID_PDF_BYTES], "event_bill.pdf", { type: "application/pdf" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as StoredEvidence;

    expect(appendedEvents).toHaveLength(1);
    const event = appendedEvents[0] as {
      fundId: string;
      type: string;
      version: number;
      payload: { expense_id: string; evidence_id: string; content_sha256: string };
    };
    expect(event.fundId).toBe(fundId);
    expect(event.type).toBe("expense.evidence_added");
    expect(event.version).toBe(1);
    expect(event.payload.expense_id).toBe(EXPENSE_ID_1);
    expect(event.payload.evidence_id).toBe(body.evidenceId);
    expect(event.payload.content_sha256).toBe(body.fileSha256);
    expect(Object.keys(event.payload).sort()).toEqual([
      "content_sha256",
      "evidence_id",
      "expense_id",
    ]);
    expect(JSON.stringify(event.payload)).not.toContain("event_bill.pdf");
  });

  it("verifies cryptographic integrity check job against stored bytes and detects tampering", async () => {
    const storageAdapter = new MemoryStorageAdapter();
    const { app, evidenceStore } = createTestApp({ storageAdapter });
    const fundId = await createTestFund(app);

    const fd = new FormData();
    fd.append("file", new File([VALID_PDF_BYTES], "audit.pdf", { type: "application/pdf" }));

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );
    expect(res.status).toBe(201);

    // Fetch the stored evidence record from the system evidence store
    const storedList = await evidenceStore.getByExpense(fundId, EXPENSE_ID_1);
    expect(storedList).toHaveLength(1);
    const storedEvidence = storedList[0];
    if (!storedEvidence?.objectKey) {
      throw new Error("Expected stored evidence with objectKey");
    }

    // Single item check should pass initially
    const initialCheck = await checkEvidenceIntegrity(storedEvidence, storageAdapter);
    expect(initialCheck.status).toBe("valid");

    // Batch integrity job should report 1 valid, 0 tampered
    const batchResult1 = await runEvidenceIntegrityJob([storedEvidence], storageAdapter);
    expect(batchResult1.totalChecked).toBe(1);
    expect(batchResult1.validCount).toBe(1);
    expect(batchResult1.tamperedCount).toBe(0);

    // Tamper with the stored bytes in durable storage
    storageAdapter.simulateTamper(storedEvidence.objectKey, new Uint8Array([0x00, 0x00, 0x00]));

    const readAfterTamper = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
    );
    expect(readAfterTamper.status).toBe(500);
    expect(await readAfterTamper.json()).toMatchObject({ error: { code: "internal" } });

    // Integrity check must now detect tampering
    const tamperedCheck = await checkEvidenceIntegrity(storedEvidence, storageAdapter);
    expect(tamperedCheck.status).toBe("tampered");
    if (tamperedCheck.status === "tampered") {
      expect(tamperedCheck.pinnedSha256).toBe(storedEvidence.fileSha256);
      expect(tamperedCheck.actualSha256).not.toBe(storedEvidence.fileSha256);
    }

    const batchResult2 = await runEvidenceIntegrityJob([storedEvidence], storageAdapter);
    expect(batchResult2.tamperedCount).toBe(1);
    expect(batchResult2.tamperedItems).toHaveLength(1);
  });

  it("retrieves evidence list for an expense via GET endpoint", async () => {
    const { app } = createTestApp();
    const fundId = await createTestFund(app);

    const fd1 = new FormData();
    fd1.append("file", new File([VALID_JPEG_BYTES], "part1.jpg", { type: "image/jpeg" }));
    fd1.append("vendorName", "Merchant A");

    const fd2 = new FormData();
    fd2.append("file", new File([VALID_PNG_BYTES], "part2.png", { type: "image/png" }));
    fd2.append("vendorName", "Merchant B");

    await evidenceRequest(app, `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd1,
    });
    await evidenceRequest(app, `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`, {
      method: "POST",
      body: fd2,
    });

    const getRes = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
    );
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
      new File([VALID_PDF_BYTES], "confidential_bill.pdf", { type: "application/pdf" }),
    );
    fd.append("vendorName", "Secret Vendor PII");
    fd.append("gstin", "27AAPFU0939F1ZV");
    fd.append("invoiceNumber", "CONFIDENTIAL-INV-99");

    const res = await evidenceRequest(
      app,
      `/v1/funds/${fundId}/expenses/${EXPENSE_ID_1}/evidence`,
      {
        method: "POST",
        body: fd,
      },
    );
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
});
