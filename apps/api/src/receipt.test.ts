import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppDependencies } from "./dependencies.js";
import { devPolicy } from "./policy.js";
import { MemoryReceiptStore, type ReceiptRecord } from "./receipt-store.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };

function setup(overrides: Partial<AppDependencies> = {}) {
  const receiptStore = new MemoryReceiptStore();
  const app = createApp({
    principal,
    clock: () => 1700000000000,
    idGenerator: () => "00000000-0000-4000-8000-000000000099",
    logger: { log: () => undefined },
    policy: devPolicy,
    receiptStore,
    ...overrides,
  });
  return { app, receiptStore };
}

const mockReceipt: ReceiptRecord = {
  donationId: "11111111-1111-4111-8111-111111111111",
  fundId: "22222222-2222-4222-8222-222222222222",
  fundTitle: "RoboCup 2026 Asia Fund",
  amountPaise: 500000, // ₹5,000
  utr: "123456789012",
  donorDisplayName: "Aarav Sharma",
  donorNameChoice: "initials",
  status: "verified",
  createdAt: "2026-10-25T10:00:00.000Z",
  verifiedAt: "2026-10-25T11:30:00.000Z",
  proofUrl: "/verify?donationId=11111111-1111-4111-8111-111111111111",
};

interface ReceiptJsonResponse {
  donationId: string;
  fundId: string;
  fundName: string;
  amountPaise: string;
  utr: string;
  donorDisplayName?: string;
  status: string;
  isTaxReceipt: boolean;
  disclaimerEn: string;
  disclaimerHi: string;
  proofUrl: string;
}

describe("Donor Receipts API", () => {
  it("retrieves receipt details by donation ID", async () => {
    const { app, receiptStore } = setup();
    await receiptStore.addReceipt(mockReceipt);

    const res = await app.request(`/v1/receipts/${mockReceipt.donationId}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as ReceiptJsonResponse;
    expect(data.donationId).toBe(mockReceipt.donationId);
    expect(data.fundId).toBe(mockReceipt.fundId);
    expect(data.fundName).toBe("RoboCup 2026 Asia Fund");
    expect(data.amountPaise).toBe("500000");
    expect(data.utr).toBe("123456789012");
    expect(data.donorDisplayName).toBe("A. S.");
    expect(data.status).toBe("verified");
    expect(data.isTaxReceipt).toBe(false);
    expect(data.disclaimerEn).toContain("NOT a tax-exempt receipt under Section 80G");
    expect(data.disclaimerHi).toContain("80G के तहत कर छूट रसीद नहीं है");
    expect(data.proofUrl).toBe("/verify?donationId=11111111-1111-4111-8111-111111111111");
  });

  it("rejects lookup by bare 12-digit UTR reference to prevent unauthenticated enumeration", async () => {
    const { app, receiptStore } = setup();
    await receiptStore.addReceipt(mockReceipt);

    const res = await app.request(`/v1/receipts/${mockReceipt.utr}`);
    expect(res.status).toBe(404);
  });

  it("redacts donor display name when donor name choice is anonymous", async () => {
    const { app, receiptStore } = setup();
    const anonymousReceipt: ReceiptRecord = {
      ...mockReceipt,
      donationId: "33333333-3333-4333-8333-333333333333",
      donorDisplayName: "Secret Philanthropist",
      donorNameChoice: "anonymous",
    };
    await receiptStore.addReceipt(anonymousReceipt);

    const res = await app.request(`/v1/receipts/${anonymousReceipt.donationId}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as ReceiptJsonResponse;
    expect(data.donorDisplayName).toBeUndefined();
    expect(data.donationId).toBe(anonymousReceipt.donationId);
  });

  it("preserves full donor display name when donor name choice is full", async () => {
    const { app, receiptStore } = setup();
    const fullReceipt: ReceiptRecord = {
      ...mockReceipt,
      donationId: "44444444-4444-4444-8444-444444444444",
      donorDisplayName: "Aarav Sharma",
      donorNameChoice: "full",
    };
    await receiptStore.addReceipt(fullReceipt);

    const res = await app.request(`/v1/receipts/${fullReceipt.donationId}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as ReceiptJsonResponse;
    expect(data.donorDisplayName).toBe("Aarav Sharma");
  });

  it("returns 404 for nonexistent receipt", async () => {
    const { app } = setup();

    const res = await app.request("/v1/receipts/00000000-0000-4000-8000-999999999999");
    expect(res.status).toBe(404);
  });

  it("downloads binary PDF receipt file", async () => {
    const { app, receiptStore } = setup();
    await receiptStore.addReceipt(mockReceipt);

    const res = await app.request(`/v1/receipts/${mockReceipt.donationId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(
      `filename="receipt-${mockReceipt.donationId}.pdf"`,
    );

    const buffer = await res.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 5)));
    expect(header).toBe("%PDF-");
  });

  it("retrieves vector SVG receipt image", async () => {
    const { app, receiptStore } = setup();
    await receiptStore.addReceipt(mockReceipt);

    const res = await app.request(`/v1/receipts/${mockReceipt.donationId}/svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toContain(
      `filename="receipt-${mockReceipt.donationId}.svg"`,
    );

    const svg = await res.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("RoboCup 2026 Asia Fund");
    expect(svg.toUpperCase()).toContain("NOT AN 80G");
  });
});
