import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { ApprovalPinModal } from "./approval-pin-modal";
import { RejectionModal } from "./rejection-modal";

describe("ApprovalPinModal", () => {
  it("does not render when isOpen is false", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders accessible modal with title and controls when open", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          amountPaise={paise(15000)}
          payeeName="Stationery Works"
        />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Enter 6-digit approval PIN")).toBeTruthy();
    expect(screen.getByText(/₹150.00 → Stationery Works/)).toBeTruthy();
    expect(screen.getByLabelText("Approval PIN")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("validates 6-digit PIN and calls onConfirm", async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal isOpen={true} onClose={vi.fn()} onConfirm={handleConfirm} />
      </LocaleProvider>,
    );

    const pinInput = screen.getByLabelText("Approval PIN");

    // Invalid PIN (< 6 digits)
    await user.type(pinInput, "1234");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(screen.getByText("PIN must be exactly 6 digits")).toBeTruthy();
    expect(handleConfirm).not.toHaveBeenCalled();

    // Valid 6 digits
    await user.type(pinInput, "56"); // now "123456"
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(handleConfirm).toHaveBeenCalledWith("123456");
    });
  });

  it("closes on Escape key press", () => {
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

describe("RejectionModal", () => {
  it("does not render when isOpen is false", () => {
    render(
      <LocaleProvider initialLocale="en">
        <RejectionModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("enforces mandatory rejection reason and calls onConfirm", async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(
      <LocaleProvider initialLocale="en">
        <RejectionModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={handleConfirm}
          amountPaise={paise(15000)}
          payeeName="Vendor"
        />
      </LocaleProvider>,
    );

    const reasonInput = screen.getByLabelText("Rejection reason");

    // Empty submission
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByText("Reason is required (at least 5 characters)")).toBeTruthy();
    expect(handleConfirm).not.toHaveBeenCalled();

    // Valid reason
    await user.type(reasonInput, "Not approved in meeting");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() => {
      expect(handleConfirm).toHaveBeenCalledWith("Not approved in meeting");
    });
  });

  it("renders in Hindi when Hindi locale is active", () => {
    render(
      <LocaleProvider initialLocale="hi">
        <RejectionModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} />
      </LocaleProvider>,
    );

    expect(screen.getByText("खर्च अनुरोध अस्वीकार करें")).toBeTruthy();
    expect(screen.getByLabelText("अस्वीकृति का कारण")).toBeTruthy();
    expect(screen.getByRole("button", { name: "अस्वीकृति की पुष्टि करें" })).toBeTruthy();
  });
});
