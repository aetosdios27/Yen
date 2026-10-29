import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import * as apiClientModule from "../lib/api-client";
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

  it("verifies PIN with action-bound hash and passes approval token to onConfirm", async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();
    const mockPost = vi.fn().mockResolvedValue({
      response: { status: 200 },
      data: { approvalToken: "token-uuid-1234", expiresAt: "2026-10-29T12:00:00Z" },
    });
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
    } as unknown as apiClientModule.YenClient);

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={handleConfirm}
          fundId="00000000-0000-4000-8000-000000000001"
          targetId="00000000-0000-4000-8000-000000000002"
          action="expense:approve"
        />
      </LocaleProvider>,
    );

    const pinInput = screen.getByLabelText("Approval PIN");
    await user.type(pinInput, "482915");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(handleConfirm).toHaveBeenCalledWith("token-uuid-1234");
    });

    expect(mockPost).toHaveBeenCalledWith(
      "/v1/auth/pin/verify",
      expect.objectContaining({
        body: expect.objectContaining({
          pin: "482915",
          actionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("handles temporary lockout (429) state with clear notice in English and Hindi", async () => {
    const user = userEvent.setup();
    const mockPost = vi.fn().mockResolvedValue({
      response: { status: 429 },
      error: { error: { code: "rate_limited", message: "Rate limited" } },
    });
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
    } as unknown as apiClientModule.YenClient);

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInput = screen.getByLabelText("Approval PIN");
    await user.type(pinInput, "999999");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "PIN is temporarily locked due to repeated incorrect attempts. Please try again after 30 minutes.",
        ),
      ).toBeTruthy();
    });

    // Test in Hindi
    cleanup();
    render(
      <LocaleProvider initialLocale="hi">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInputHi = screen.getByLabelText("स्वीकृति पिन");
    await user.type(pinInputHi, "999999");
    await user.click(screen.getByRole("button", { name: "स्वीकृति की पुष्टि करें" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "बार-बार गलत प्रयासों के कारण पिन अस्थायी रूप से बंद है। कृपया 30 मिनट बाद पुनः प्रयास करें।",
        ),
      ).toBeTruthy();
    });
  });

  it("handles cooling-off state after PIN reset with clear copy in English and Hindi", async () => {
    const user = userEvent.setup();
    const mockPost = vi.fn().mockResolvedValue({
      response: { status: 403 },
      error: {
        error: {
          code: "forbidden",
          details: [{ message: "PIN is in cooling-off period until 2026-10-30T10:00:00Z" }],
        },
      },
    });
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
    } as unknown as apiClientModule.YenClient);

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInput = screen.getByLabelText("Approval PIN");
    await user.type(pinInput, "123456");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "PIN is in a 24-hour security cooling-off period following a recent reset. Approvals are temporarily paused.",
        ),
      ).toBeTruthy();
    });

    // Test Hindi
    cleanup();
    render(
      <LocaleProvider initialLocale="hi">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInputHi = screen.getByLabelText("स्वीकृति पिन");
    await user.type(pinInputHi, "123456");
    await user.click(screen.getByRole("button", { name: "स्वीकृति की पुष्टि करें" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "हालिया रीसेट के बाद पिन 24 घंटे की सुरक्षा कूलिंग-ऑफ अवधि में है। अनुमोदन अस्थायी रूप से रोके गए हैं।",
        ),
      ).toBeTruthy();
    });
  });

  it("handles permanent lockout after 10 failed attempts with clear copy in English and Hindi", async () => {
    const user = userEvent.setup();
    const mockPost = vi.fn().mockResolvedValue({
      response: { status: 403 },
      error: {
        error: {
          code: "forbidden",
          details: [{ message: "PIN is locked out after 10 failed attempts in 24 hours" }],
        },
      },
    });
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
    } as unknown as apiClientModule.YenClient);

    render(
      <LocaleProvider initialLocale="en">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInput = screen.getByLabelText("Approval PIN");
    await user.type(pinInput, "123456");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "PIN is locked out after 10 failed attempts. Contact an administrator to reset or unlock.",
        ),
      ).toBeTruthy();
    });

    // Test Hindi
    cleanup();
    render(
      <LocaleProvider initialLocale="hi">
        <ApprovalPinModal
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          fundId="f1"
          targetId="e1"
        />
      </LocaleProvider>,
    );

    const pinInputHi = screen.getByLabelText("स्वीकृति पिन");
    await user.type(pinInputHi, "123456");
    await user.click(screen.getByRole("button", { name: "स्वीकृति की पुष्टि करें" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "10 असफल प्रयासों के बाद पिन स्थायी रूप से बंद कर दिया गया है। अनलॉक करने के लिए व्यवस्थापक से संपर्क करें।",
        ),
      ).toBeTruthy();
    });
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
