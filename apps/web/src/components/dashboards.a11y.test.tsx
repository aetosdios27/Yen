import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { expectNoA11yViolations } from "../test/a11y";
import { ApprovalPinModal } from "./approval-pin-modal";
import { ExpenseForm } from "./expense-form";
import { ExpenseTimeline } from "./expense-timeline";
import { RejectionModal } from "./rejection-modal";

describe("Dashboard and Approver A11y & Navigation", () => {
  it("ExpenseTimeline passes axe checks in English", async () => {
    await expectNoA11yViolations(
      <ExpenseTimeline
        status="submitted"
        amountPaise={paise(125000)}
        payeeName="Hardware Store"
        createdAt="2026-10-28 10:00"
        submittedAt="2026-10-28 10:05"
        holdReservedAt="2026-10-28 10:05"
        approvals={[
          { approverId: "appr-1", approverName: "Asha Rao", approvedAt: "2026-10-28 10:15" },
        ]}
        requiredQuorum={2}
      />,
      "en",
    );
  });

  it("ExpenseTimeline passes axe checks in Hindi", async () => {
    await expectNoA11yViolations(
      <ExpenseTimeline
        status="submitted"
        amountPaise={paise(125000)}
        payeeName="हार्डवेयर स्टोर"
        createdAt="2026-10-28 10:00"
        submittedAt="2026-10-28 10:05"
        holdReservedAt="2026-10-28 10:05"
        approvals={[
          { approverId: "appr-1", approverName: "आशा राव", approvedAt: "2026-10-28 10:15" },
        ]}
        requiredQuorum={2}
      />,
      "hi",
    );
  });

  it("ExpenseForm passes axe checks on input step in English", async () => {
    await expectNoA11yViolations(
      <ExpenseForm
        fundId="test-fund"
        spendableBalancePaise={paise(500000)}
        initialValues={{
          amountRupees: "250.00",
          payeeName: "Vendor Name",
          payeeUpi: "vendor@bank",
          purpose: "Repairs",
        }}
        onSubmit={vi.fn()}
      />,
      "en",
    );
  });

  it("ExpenseForm passes axe checks on input step in Hindi", async () => {
    await expectNoA11yViolations(
      <ExpenseForm
        fundId="test-fund"
        spendableBalancePaise={paise(500000)}
        initialValues={{
          amountRupees: "250.00",
          payeeName: "विक्रेता",
          payeeUpi: "vendor@bank",
          purpose: "मरम्मत",
        }}
        onSubmit={vi.fn()}
      />,
      "hi",
    );
  });

  it("ApprovalPinModal passes axe checks in English", async () => {
    await expectNoA11yViolations(
      <ApprovalPinModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        amountPaise={paise(50000)}
        payeeName="Payee"
      />,
      "en",
    );
  });

  it("ApprovalPinModal passes axe checks in Hindi", async () => {
    await expectNoA11yViolations(
      <ApprovalPinModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        amountPaise={paise(50000)}
        payeeName="विक्रेता"
      />,
      "hi",
    );
  });

  it("RejectionModal passes axe checks in English", async () => {
    await expectNoA11yViolations(
      <RejectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        amountPaise={paise(50000)}
        payeeName="Payee"
      />,
      "en",
    );
  });

  it("RejectionModal passes axe checks in Hindi", async () => {
    await expectNoA11yViolations(
      <RejectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        amountPaise={paise(50000)}
        payeeName="विक्रेता"
      />,
      "hi",
    );
  });

  it("supports keyboard navigation and tab ordering in ExpenseForm", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm fundId="test-fund" onSubmit={vi.fn()} />
      </LocaleProvider>,
    );

    const amountInput = screen.getByLabelText(/Amount \(₹\)/);
    const payeeInput = screen.getByLabelText(/Payee name/);
    const upiInput = screen.getByLabelText(/Payee UPI VPA/);
    const purposeInput = screen.getByLabelText(/Purpose/);
    const reviewBtn = screen.getByRole("button", { name: "Review expense" });

    amountInput.focus();
    expect(document.activeElement).toBe(amountInput);

    await user.tab();
    expect(document.activeElement).toBe(payeeInput);

    await user.tab();
    expect(document.activeElement).toBe(upiInput);

    await user.tab();
    expect(document.activeElement).toBe(purposeInput);

    // Tab to receipt input then button
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(reviewBtn);
  });

  it("supports keyboard dismissal via Escape in ApprovalPinModal", () => {
    const handleClose = vi.fn();

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal isOpen={true} onClose={handleClose} onConfirm={vi.fn()} />
      </LocaleProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
