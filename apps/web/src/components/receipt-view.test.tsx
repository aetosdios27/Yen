import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { type ReceiptData, ReceiptView } from "./receipt-view";

const mockVerifiedReceipt: ReceiptData = {
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

const mockPledgedReceipt: ReceiptData = {
  ...mockVerifiedReceipt,
  status: "pledged",
  donorName: undefined,
};

function renderReceipt(
  receipt: ReceiptData = mockVerifiedReceipt,
  props?: {
    apiUrl?: string;
    onSubscribe?: (s: {
      contact: string;
      contactType: "email" | "phone";
      channel: "email" | "whatsapp" | "sms";
      weeklySummary: boolean;
      instantAlerts: boolean;
    }) => Promise<boolean>;
  },
) {
  return render(
    <LocaleProvider>
      <ReceiptView receipt={receipt} {...props} />
    </LocaleProvider>,
  );
}

describe("ReceiptView", () => {
  it("renders verified donation certificate details correctly", () => {
    renderReceipt(mockVerifiedReceipt, { apiUrl: "http://api.test" });

    expect(screen.getByRole("heading", { name: "Verified Donation Certificate" })).toBeDefined();
    expect(screen.getByText("RoboCup Asia Fund")).toBeDefined();
    expect(screen.getByText("₹5,000.00")).toBeDefined();
    expect(screen.getByText("Priya Sharma")).toBeDefined();
    expect(screen.getByText("123456789012")).toBeDefined();
    expect(screen.getByRole("link", { name: "Check live verification record ↗" })).toBeDefined();
  });

  it("renders pending pledge receipt with anonymous contributor fallback", () => {
    renderReceipt(mockPledgedReceipt);

    expect(screen.getByRole("heading", { name: "Donation Pledge Receipt" })).toBeDefined();
    expect(screen.getByText("Generous Contributor")).toBeDefined();
  });

  it("displays prominent bilingual non-80G tax disclaimer", () => {
    renderReceipt();

    const note = screen.getByRole("note", { name: "Notice: Not an 80G Tax Receipt" });
    expect(note).toBeDefined();
    expect(
      screen.getByText(
        "This contribution is not eligible for tax deductions under Section 80G of the Income Tax Act.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("यह अंशदान आयकर अधिनियम की धारा 80G के तहत कर कटौती के लिए पात्र नहीं है।"),
    ).toBeDefined();
  });

  it("renders scannable vector QR code with aria-label", () => {
    renderReceipt();

    const qr = screen.getByRole("img", {
      name: "Scan to check this donation on the public record",
    });
    expect(qr).toBeDefined();
  });

  it("renders download buttons with correct URLs", () => {
    renderReceipt(mockVerifiedReceipt, { apiUrl: "http://api.test" });

    const pdfLink = screen.getByRole("link", { name: "Download PDF Receipt" });
    expect(pdfLink.getAttribute("href")).toBe(
      "http://api.test/v1/receipts/00000000-0000-0000-0000-000000000001/pdf",
    );

    const svgLink = screen.getByRole("link", { name: "Download SVG Receipt" });
    expect(svgLink.getAttribute("href")).toBe(
      "http://api.test/v1/receipts/00000000-0000-0000-0000-000000000001/svg",
    );
  });

  it("submits fund update subscription successfully", async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn().mockResolvedValue(true);
    renderReceipt(mockVerifiedReceipt, { onSubscribe });

    const input = screen.getByLabelText("Email or mobile number");
    await user.type(input, "donor@example.com");

    const submitBtn = screen.getByRole("button", { name: "Subscribe to fund updates" });
    await user.click(submitBtn);

    expect(onSubscribe).toHaveBeenCalledWith({
      contact: "donor@example.com",
      contactType: "email",
      channel: "email",
      weeklySummary: true,
      instantAlerts: true,
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("You are subscribed!");
  });

  it("shows error when subscription fails", async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn().mockResolvedValue(false);
    renderReceipt(mockVerifiedReceipt, { onSubscribe });

    const input = screen.getByLabelText("Email or mobile number");
    await user.type(input, "+919876543210");

    const submitBtn = screen.getByRole("button", { name: "Subscribe to fund updates" });
    await user.click(submitBtn);

    expect(onSubscribe).toHaveBeenCalledWith({
      contact: "+919876543210",
      contactType: "phone",
      channel: "whatsapp",
      weeklySummary: true,
      instantAlerts: true,
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not save your subscription");
  });
});
