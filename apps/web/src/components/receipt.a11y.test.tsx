import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { runAxe } from "../test/a11y";
import { type ReceiptData, ReceiptView } from "./receipt-view";

const mockReceipt: ReceiptData = {
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

describe("ReceiptView Accessibility", () => {
  it.each(["en", "hi"] as const)("has no axe violations in %s", async (locale) => {
    const { container } = render(
      <LocaleProvider initialLocale={locale}>
        <main>
          <ReceiptView receipt={mockReceipt} />
        </main>
      </LocaleProvider>,
    );

    expect(await runAxe(container)).toHaveNoViolations();
  });

  it("has no axe violations for pending status receipt", async () => {
    const pendingReceipt: ReceiptData = {
      ...mockReceipt,
      status: "pledged",
    };

    const { container } = render(
      <LocaleProvider>
        <main>
          <ReceiptView receipt={pendingReceipt} />
        </main>
      </LocaleProvider>,
    );

    expect(await runAxe(container)).toHaveNoViolations();
  });

  it("has no axe violations after subscribing to updates", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LocaleProvider>
        <main>
          <ReceiptView receipt={mockReceipt} onSubscribe={async () => true} />
        </main>
      </LocaleProvider>,
    );

    await user.type(screen.getByLabelText("Email or mobile number"), "donor@example.com");
    await user.click(screen.getByRole("button", { name: "Subscribe to fund updates" }));
    await screen.findByRole("status");

    expect(await runAxe(container)).toHaveNoViolations();
  });
});
