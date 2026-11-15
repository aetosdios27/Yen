import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { ExpenseForm } from "./expense-form";

describe("ExpenseForm", () => {
  it("renders all form fields with labels and hints", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm fundId="fund-1" onSubmit={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.getByLabelText(/Amount \(₹\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Payee name/)).toBeTruthy();
    expect(screen.getByLabelText(/Payee UPI VPA/)).toBeTruthy();
    expect(screen.getByLabelText(/Purpose/)).toBeTruthy();
    expect(screen.getByLabelText(/Receipt \/ Bill reference/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review expense" })).toBeTruthy();
  });

  it("shows real-time validation errors on empty submission", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm fundId="fund-1" onSubmit={vi.fn()} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review expense" }));

    expect(screen.getByText("Please enter an amount")).toBeTruthy();
    expect(screen.getByText("Please enter payee name (at least 2 characters)")).toBeTruthy();
    expect(screen.getByText("Enter a valid UPI ID (e.g. name@bank)")).toBeTruthy();
    expect(screen.getByText("Please enter a purpose (at least 3 characters)")).toBeTruthy();
  });

  it("validates invalid amount and enforces spendable balance limit", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm
          fundId="fund-1"
          spendableBalancePaise={paise(50000)} // ₹500.00
          onSubmit={vi.fn()}
        />
      </LocaleProvider>,
    );

    const amountInput = screen.getByLabelText(/Amount \(₹\)/);

    // Invalid format
    fireEvent.change(amountInput, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Enter a valid rupee amount (up to 2 decimals)")).toBeTruthy();

    // Zero amount
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Amount must be greater than zero")).toBeTruthy();

    // Exceeds spendable balance
    fireEvent.change(amountInput, { target: { value: "750" } }); // ₹750 > ₹500
    fireEvent.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Amount exceeds spendable balance of ₹500.00")).toBeTruthy();
  });

  it("validates UPI VPA format", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm fundId="fund-1" onSubmit={vi.fn()} />
      </LocaleProvider>,
    );

    const upiInput = screen.getByLabelText(/Payee UPI VPA/);
    fireEvent.change(upiInput, { target: { value: "invalid-upi" } });
    fireEvent.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Enter a valid UPI ID (e.g. name@bank)")).toBeTruthy();
  });

  it("transitions to plain-language review screen and submits converted integer paise", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm
          fundId="fund-1"
          spendableBalancePaise={paise(100000)}
          onSubmit={handleSubmit}
        />
      </LocaleProvider>,
    );

    await user.type(screen.getByLabelText(/Amount \(₹\)/), "250.50");
    await user.type(screen.getByLabelText(/Payee name/), "Sunil Traders");
    await user.type(screen.getByLabelText(/Payee UPI VPA/), "sunil@okhdfcbank");
    await user.type(screen.getByLabelText(/Purpose/), "Paint for hall");
    await user.type(screen.getByLabelText(/Receipt \/ Bill reference/), "INV-889");

    await user.click(screen.getByRole("button", { name: "Review expense" }));

    // Review screen checks
    expect(screen.getByText("Review expense request")).toBeTruthy();
    expect(screen.getByText("₹250.50")).toBeTruthy();
    expect(screen.getByText("Sunil Traders")).toBeTruthy();
    expect(screen.getByText("sunil@okhdfcbank")).toBeTruthy();
    expect(screen.getByText("Paint for hall")).toBeTruthy();
    expect(screen.getByText("INV-889")).toBeTruthy();

    // Confirm submit
    await user.click(screen.getByRole("button", { name: "Submit expense" }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    expect(handleSubmit).toHaveBeenCalledWith({
      amountPaise: 25050,
      amountRupees: "250.50",
      payeeName: "Sunil Traders",
      payeeUpi: "sunil@okhdfcbank",
      purpose: "Paint for hall",
      receiptRef: "INV-889",
    });
  });

  it("allows navigating back to edit from review screen", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm
          fundId="fund-1"
          initialValues={{
            amountRupees: "100",
            payeeName: "Ramesh",
            payeeUpi: "ramesh@upi",
            purpose: "Hardware",
          }}
          onSubmit={vi.fn()}
        />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Review expense request")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.getByDisplayValue("100")).toBeTruthy();
    expect(screen.getByDisplayValue("Ramesh")).toBeTruthy();
  });

  it("passes the chosen bill file to the submit handler and shows submit failures", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Bill upload failed"));
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm
          fundId="fund-1"
          initialValues={{
            amountRupees: "100",
            payeeName: "Ramesh",
            payeeUpi: "ramesh@upi",
            purpose: "Hardware",
          }}
          onSubmit={onSubmit}
        />
      </LocaleProvider>,
    );

    const bill = new File([new Uint8Array([137, 80, 78, 71])], "bill.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/Bill photo or PDF/), bill);
    await user.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("bill.png")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Submit expense" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ receiptFile: bill }));
    expect(await screen.findByText("Bill upload failed")).toBeTruthy();
  });

  it("rejects a bill file that is not an image or PDF", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseForm
          fundId="fund-1"
          initialValues={{
            amountRupees: "100",
            payeeName: "Ramesh",
            payeeUpi: "ramesh@upi",
            purpose: "Hardware",
          }}
          onSubmit={vi.fn()}
        />
      </LocaleProvider>,
    );

    await user.upload(
      screen.getByLabelText(/Bill photo or PDF/),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Review expense" }));
    expect(screen.getByText("Choose a JPEG, PNG, WebP or PDF file up to 10 MB")).toBeTruthy();
  });

  it("renders in Hindi when Hindi locale is active", () => {
    render(
      <LocaleProvider initialLocale="hi">
        <ExpenseForm fundId="fund-1" onSubmit={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.getByLabelText(/रकम \(₹\)/)).toBeTruthy();
    expect(screen.getByLabelText(/भुगतान पाने वाले का नाम/)).toBeTruthy();
    expect(screen.getByLabelText(/भुगतान पाने वाले का UPI VPA/)).toBeTruthy();
    expect(screen.getByLabelText(/उद्देश्य/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "खर्च की समीक्षा करें" })).toBeTruthy();
  });
});
