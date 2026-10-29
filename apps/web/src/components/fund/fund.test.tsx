import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n";
import { SANITIZED_DEMO_FUND } from "./fixtures";
import { FundHeader } from "./fund-header";
import { FundTimeline } from "./fund-timeline";
import { HowDoIKnowModal } from "./how-do-i-know-modal";
import { MoneySummary } from "./money-summary";
import { PublicFundView } from "./public-fund-view";
import { SpendingBreakdown } from "./spending-breakdown";
import { VerifiedBadge } from "./verified-badge";

describe("Public Fund Components", () => {
  describe("FundHeader", () => {
    it("renders fund title, purpose, org badge and donation link", () => {
      render(
        <LocaleProvider initialLocale="en">
          <FundHeader
            fundId={SANITIZED_DEMO_FUND.id}
            name={SANITIZED_DEMO_FUND.name}
            purpose={SANITIZED_DEMO_FUND.purpose}
            org={SANITIZED_DEMO_FUND.org}
          />
        </LocaleProvider>,
      );

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("RoboCup 2026 Asia Fund");

      expect(screen.getByText(SANITIZED_DEMO_FUND.purpose)).not.toBeNull();
      expect(screen.getByText("IIT Delhi Robotics Club")).not.toBeNull();

      const donateLink = screen.getByRole("link", { name: /Donate via UPI/i });
      expect(donateLink).not.toBeNull();
      expect(donateLink.getAttribute("href")).toBe(`/funds/${SANITIZED_DEMO_FUND.id}/donate`);
    });

    it("renders correctly in Hindi without English leaks", () => {
      render(
        <LocaleProvider initialLocale="hi">
          <FundHeader
            fundId={SANITIZED_DEMO_FUND.id}
            name={SANITIZED_DEMO_FUND.name}
            purpose={SANITIZED_DEMO_FUND.purpose}
            org={SANITIZED_DEMO_FUND.org}
          />
        </LocaleProvider>,
      );

      const donateLink = screen.getByRole("link", { name: /UPI से दान करें/i });
      expect(donateLink).not.toBeNull();
      expect(screen.queryByText(/Donate via UPI/i)).toBeNull();
    });
  });

  describe("MoneySummary", () => {
    it("renders total raised, total spent, and current balance in ₹", () => {
      render(
        <LocaleProvider initialLocale="en">
          <MoneySummary money={SANITIZED_DEMO_FUND.money} />
        </LocaleProvider>,
      );

      expect(screen.getByText("Total raised")).not.toBeNull();
      expect(screen.getByText("Total spent")).not.toBeNull();
      expect(screen.getByText("Current balance")).not.toBeNull();

      // Check formatted rupee amounts
      expect(screen.getByText("₹5,00,000.00")).not.toBeNull();
      expect(screen.getByText("₹3,18,500.00")).not.toBeNull();
      expect(screen.getByText("₹1,81,500.00")).not.toBeNull();
    });

    it("renders in Hindi with proper translations", () => {
      render(
        <LocaleProvider initialLocale="hi">
          <MoneySummary money={SANITIZED_DEMO_FUND.money} />
        </LocaleProvider>,
      );

      expect(screen.getByText("कुल जुटाया")).not.toBeNull();
      expect(screen.getByText("कुल खर्च")).not.toBeNull();
      expect(screen.getByText("वर्तमान शेष")).not.toBeNull();

      expect(screen.queryByText("Total raised")).toBeNull();
      expect(screen.queryByText("Total spent")).toBeNull();
      expect(screen.queryByText("Current balance")).toBeNull();
    });
  });

  describe("SpendingBreakdown", () => {
    it("renders category breakdown with progress bars and amounts", () => {
      render(
        <LocaleProvider initialLocale="en">
          <SpendingBreakdown categories={SANITIZED_DEMO_FUND.spendingBreakdown} />
        </LocaleProvider>,
      );

      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading.textContent).toBe("Spending by category");

      expect(screen.getByText("Equipment & Hardware")).not.toBeNull();
      expect(screen.getByText("Travel & Transport")).not.toBeNull();

      const progressBars = screen.getAllByRole("progressbar");
      expect(progressBars.length).toBe(SANITIZED_DEMO_FUND.spendingBreakdown.length);
      expect(progressBars[0]?.getAttribute("aria-valuemin")).toBe("0");
      expect(progressBars[0]?.getAttribute("aria-valuemax")).toBe("100");
    });

    it("handles empty categories gracefully", () => {
      render(
        <LocaleProvider initialLocale="en">
          <SpendingBreakdown categories={[]} />
        </LocaleProvider>,
      );

      expect(screen.getByText("No spending recorded yet.")).not.toBeNull();
    });
  });

  describe("FundTimeline and Filtering", () => {
    it("renders donations and expenses with filters", async () => {
      const user = userEvent.setup();
      render(
        <LocaleProvider initialLocale="en">
          <FundTimeline timeline={SANITIZED_DEMO_FUND.timeline} onOpenExplainer={() => undefined} />
        </LocaleProvider>,
      );

      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading.textContent).toBe("Live transparency timeline");

      // Verify all items visible initially
      expect(screen.getByText("Alumni Batch 2018 Sponsorship")).not.toBeNull();
      expect(screen.getByText("Omni-wheel DC Motors & Encoders")).not.toBeNull();

      // Filter to donations only
      const donationsTab = screen.getByRole("tab", { name: /Donations/i });
      await user.click(donationsTab);

      expect(screen.getByText("Alumni Batch 2018 Sponsorship")).not.toBeNull();
      expect(screen.queryByText("Omni-wheel DC Motors & Encoders")).toBeNull();

      // Filter to expenses only
      const expensesTab = screen.getByRole("tab", { name: /Expenses/i });
      await user.click(expensesTab);

      expect(screen.queryByText("Alumni Batch 2018 Sponsorship")).toBeNull();
      expect(screen.getByText("Omni-wheel DC Motors & Encoders")).not.toBeNull();
    });
  });

  describe("VerifiedBadge and HowDoIKnowModal", () => {
    it("links to transaction evidence and opens explainer", async () => {
      const user = userEvent.setup();
      let opened = false;

      render(
        <LocaleProvider initialLocale="en">
          <VerifiedBadge
            status="verified"
            evidence={{
              id: "evi_123",
              title: "Vendor Tax Invoice",
              url: "https://evidence.yen.org/evi_123.pdf",
            }}
            verification={{
              status: "verified",
              recordProofUrl: "/records/proof/item_1",
            }}
            onOpenExplainer={() => {
              opened = true;
            }}
          />
        </LocaleProvider>,
      );

      const evidenceLink = screen.getByRole("link", { name: /View bill or receipt/i });
      expect(evidenceLink.getAttribute("href")).toBe("https://evidence.yen.org/evi_123.pdf");

      const proofLink = screen.getByRole("link", { name: /View proof record/i });
      expect(proofLink.getAttribute("href")).toBe("/records/proof/item_1");

      const howButton = screen.getByRole("button", { name: /How do I know\?/i });
      await user.click(howButton);
      expect(opened).toBe(true);
    });

    it("renders modal with four plain-language safeguards and closes on button click", async () => {
      const user = userEvent.setup();
      let closed = false;

      render(
        <LocaleProvider initialLocale="en">
          <HowDoIKnowModal
            isOpen={true}
            onClose={() => {
              closed = true;
            }}
          />
        </LocaleProvider>,
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-labelledby")).toBe("how-do-i-know-title");

      // Verify the 4 plain language safeguards
      expect(screen.getByText(/1\. Bank statement confirmation/i)).not.toBeNull();
      expect(screen.getByText(/2\. Multiple member approvals/i)).not.toBeNull();
      expect(screen.getByText(/3\. Original receipt evidence/i)).not.toBeNull();
      expect(screen.getByText(/4\. Tamper-evident record/i)).not.toBeNull();

      // Ensure no jargon appears in the modal
      expect(dialog.textContent).not.toMatch(/\b(hash|block|ledger|wallet|merkle)\b|on-chain/i);

      const closeButtons = screen.getAllByRole("button", { name: "Close explainer" });
      expect(closeButtons.length).toBeGreaterThan(0);
      const closeBtn = closeButtons[0];
      if (closeBtn) {
        await user.click(closeBtn);
      }
      expect(closed).toBe(true);
    });
  });

  describe("PublicFundView integrated page", () => {
    it("renders completely in Hindi with zero English leakage in UI strings", () => {
      render(
        <LocaleProvider initialLocale="hi">
          <PublicFundView fund={SANITIZED_DEMO_FUND} />
        </LocaleProvider>,
      );

      // Check key Hindi labels
      expect(screen.getByLabelText("पैसों का विवरण")).not.toBeNull();
      expect(screen.getByText("कुल जुटाया")).not.toBeNull();
      expect(screen.getByText("कुल खर्च")).not.toBeNull();
      expect(screen.getByText("वर्तमान शेष")).not.toBeNull();
      expect(screen.getByText("श्रेणी अनुसार खर्च")).not.toBeNull();
      expect(screen.getByText("सीधा पारदर्शिता विवरण")).not.toBeNull();
      expect(screen.getByRole("link", { name: /UPI से दान करें/i })).not.toBeNull();

      // Check absence of English equivalents
      expect(screen.queryByText("Money summary")).toBeNull();
      expect(screen.queryByText("Total raised")).toBeNull();
      expect(screen.queryByText("Total spent")).toBeNull();
      expect(screen.queryByText("Current balance")).toBeNull();
      expect(screen.queryByText("Spending by category")).toBeNull();
      expect(screen.queryByText("Live transparency timeline")).toBeNull();
      expect(screen.queryByText("Donate via UPI")).toBeNull();
    });
  });
});
