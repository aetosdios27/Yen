import { notFound } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import ReceiptPage, { generateMetadata } from "./page";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("../../../env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://api.test" },
}));

const mockReceiptPayload = {
  donationId: "00000000-0000-0000-0000-000000000001",
  fundId: "11111111-1111-1111-1111-111111111111",
  fundName: "RoboCup Asia Fund",
  amountPaise: "500000",
  status: "verified",
  utr: "123456789012",
  occurredAt: "2026-10-25T10:30:00Z",
  donorName: "Priya Sharma",
  verificationUrl: "https://yen.app/verify?donationId=00000000-0000-0000-0000-000000000001",
  isTaxExempt: false,
  taxDisclaimer: {
    en: "This contribution is not eligible for tax deductions under Section 80G of the Income Tax Act.",
    hi: "यह अंशदान आयकर अधिनियम की धारा 80G के तहत कर कटौती के लिए पात्र नहीं है।",
  },
  downloadUrls: {
    pdf: "/v1/receipts/00000000-0000-0000-0000-000000000001/pdf",
    svg: "/v1/receipts/00000000-0000-0000-0000-000000000001/svg",
  },
};

describe("ReceiptPage Server Component", () => {
  it("renders receipt view when receipt is fetched successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockReceiptPayload,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const element = await ReceiptPage({
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
      });

      expect(element).toBeDefined();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://api.test/v1/receipts/00000000-0000-0000-0000-000000000001",
        { cache: "no-store" },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls notFound() when receipt returns 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await ReceiptPage({
        params: Promise.resolve({ id: "non-existent-id" }),
      });

      expect(notFound).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("generates metadata for verified receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockReceiptPayload,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const meta = await generateMetadata({
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
      });

      expect(meta.title).toBe("Donation Receipt · RoboCup Asia Fund · Yen");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
