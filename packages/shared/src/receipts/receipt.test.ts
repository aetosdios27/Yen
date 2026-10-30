import { describe, expect, it } from "vitest";
import { paise } from "../paise.js";
import { generateReceiptPdf } from "./pdf.js";
import { generateReceiptSvg } from "./svg.js";
import { type DonorReceiptData, RECEIPT_DISCLAIMER_EN, RECEIPT_DISCLAIMER_HI } from "./types.js";

const sampleReceipt: DonorReceiptData = {
  donationId: "123e4567-e89b-12d3-a456-426614174000",
  fundId: "123e4567-e89b-12d3-a456-426614174001",
  fundTitle: "RoboCup 2026 Asia Fund",
  amountPaise: paise(500000), // ₹5,000.00
  utr: "123456789012",
  status: "verified",
  donorDisplayName: "Vikram Malhotra",
  donorNameChoice: "full",
  createdAt: "2026-10-29T10:00:00.000Z",
  verifiedAt: "2026-10-29T10:05:00.000Z",
  proofUrl: "https://yen.org.in/verify?donationId=123e4567-e89b-12d3-a456-426614174000",
  isTaxReceipt: false,
  disclaimerEn: RECEIPT_DISCLAIMER_EN,
  disclaimerHi: RECEIPT_DISCLAIMER_HI,
};

describe("generateReceiptSvg", () => {
  it("generates a valid SVG document with essential receipt fields", () => {
    const svg = generateReceiptSvg(sampleReceipt);

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("</svg>");
    expect(svg).toContain("RoboCup 2026 Asia Fund");
    expect(svg).toContain("₹5,000.00");
    expect(svg).toContain("123456789012");
    expect(svg).toContain("Vikram Malhotra");
    expect(svg).toContain("123e4567-e89b-12d3-a456-426614174000");
  });

  it("contains scannable QR code vector path", () => {
    const svg = generateReceiptSvg(sampleReceipt);
    expect(svg).toContain('<path d="M');
    expect(svg).toContain(
      "https://yen.org.in/verify?donationId=123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("explicitly includes both English and Hindi non-80G tax disclaimers", () => {
    const svg = generateReceiptSvg(sampleReceipt);

    expect(svg).toContain("NOT AN 80G TAX EXEMPTION RECEIPT");
    expect(svg).toContain("80G कर छूट रसीद नहीं है");
    expect(svg).toContain(RECEIPT_DISCLAIMER_EN);
    expect(svg).toContain(RECEIPT_DISCLAIMER_HI);
  });

  it("renders verified status badge for verified donation", () => {
    const svg = generateReceiptSvg(sampleReceipt);
    expect(svg).toContain("VERIFIED CONTRIBUTION");
    expect(svg).toContain("सत्यापित योगदान");
  });

  it("renders waiting status badge for pledged unverified donation", () => {
    const pledgedReceipt: DonorReceiptData = {
      ...sampleReceipt,
      status: "pledged",
      verifiedAt: null,
    };
    const svg = generateReceiptSvg(pledgedReceipt);
    expect(svg).toContain("RECORDED (WAITING FOR BANK)");
    expect(svg).toContain("दर्ज (बैंक मिलान प्रतीक्षारत)");
  });

  it("handles anonymous donor preference cleanly", () => {
    const anonReceipt: DonorReceiptData = {
      ...sampleReceipt,
      donorDisplayName: null,
      donorNameChoice: "anonymous",
    };
    const svg = generateReceiptSvg(anonReceipt);
    expect(svg).toContain("Anonymous Donor");
  });
});

describe("generateReceiptPdf", () => {
  it("generates a valid binary PDF-1.4 file", () => {
    const pdfBytes = generateReceiptPdf(sampleReceipt);
    const pdfString = Buffer.from(pdfBytes).toString("utf8");

    // Standard PDF header
    expect(pdfString.startsWith("%PDF-1.4\n")).toBe(true);

    // Standard PDF trailer and EOF
    expect(pdfString).toContain("trailer\n<< /Size 6 /Root 1 0 R >>\n");
    expect(pdfString).toContain("startxref\n");
    expect(pdfString.trim().endsWith("%%EOF")).toBe(true);
  });

  it("includes all necessary PDF structure objects", () => {
    const pdfBytes = generateReceiptPdf(sampleReceipt);
    const pdfString = Buffer.from(pdfBytes).toString("utf8");

    expect(pdfString).toContain("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    expect(pdfString).toContain("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    expect(pdfString).toContain(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89]",
    );
    expect(pdfString).toContain("4 0 obj\n<< /Length ");
    expect(pdfString).toContain("5 0 obj\n<< /Font ");
    expect(pdfString).toContain("xref\n0 6\n");
  });

  it("embeds donor metadata, UTR, amount, and verification link in content stream", () => {
    const pdfBytes = generateReceiptPdf(sampleReceipt);
    const pdfString = Buffer.from(pdfBytes).toString("utf8");

    expect(pdfString).toContain("RoboCup 2026 Asia Fund");
    expect(pdfString).toContain("123456789012");
    expect(pdfString).toContain("INR 5,000.00");
    expect(pdfString).toContain("VERIFIED CONTRIBUTION");
    expect(pdfString).toContain("Vikram Malhotra");
    expect(pdfString).toContain(
      "https://yen.org.in/verify?donationId=123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("draws vector QR code modules as filled PDF rectangles", () => {
    const pdfBytes = generateReceiptPdf(sampleReceipt);
    const pdfString = Buffer.from(pdfBytes).toString("utf8");

    // Modules are drawn as `x y w h re f`
    expect(pdfString).toMatch(/\d+\.\d{2} \d+\.\d{2} \d+\.\d{2} \d+\.\d{2} re f/);
  });

  it("contains clear NOT AN 80G TAX EXEMPTION RECEIPT notice", () => {
    const pdfBytes = generateReceiptPdf(sampleReceipt);
    const pdfString = Buffer.from(pdfBytes).toString("utf8");

    expect(pdfString).toContain("IMPORTANT NOTICE: NOT AN 80G TAX EXEMPTION RECEIPT");
    expect(pdfString).toContain("does NOT qualify");
    expect(pdfString).toContain("Section 80G");
  });
});
