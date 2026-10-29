import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paise } from "@yen/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../../../../i18n";
import * as apiClientModule from "../../../../../lib/api-client";
import * as expenseService from "../../../../../lib/expense-service";
import ApproverPage from "./page";

describe("ApproverPage", () => {
  beforeEach(() => {
    expenseService.resetExpenseStore();
    const mockPost = vi.fn().mockImplementation((path: string) => {
      if (path === "/v1/auth/pin/verify") {
        return Promise.resolve({
          response: { status: 200 },
          data: { approvalToken: "token_verified_123", expiresAt: "2026-10-29T14:00:00Z" },
        });
      }
      if (path.endsWith("/approve")) {
        return Promise.resolve({
          response: { status: 200 },
          data: {
            status: "approved",
            expenseId: "exp-101",
            approvedAt: "2026-10-29T14:00:00Z",
          },
        });
      }
      if (path.endsWith("/reject")) {
        return Promise.resolve({
          response: { status: 200 },
          data: {
            status: "rejected",
            expenseId: "exp-102",
            reason: "Not approved by executive committee",
            rejectedAt: "2026-10-29T14:00:00Z",
          },
        });
      }
      return Promise.resolve({
        response: { status: 200 },
        data: {},
      });
    });
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
      GET: vi.fn().mockResolvedValue({ response: { status: 404 } }),
    } as unknown as apiClientModule.YenClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders expense summary, WhatsApp fast-decision notice, and Approve/Reject buttons", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-101" })} />
      </LocaleProvider>,
    );

    // Initial loading state
    expect(screen.getByRole("status")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Ramesh Hardware")).toBeTruthy();
    });

    expect(screen.getByText("₹450.00")).toBeTruthy();
    expect(screen.getByText("ramesh@upi")).toBeTruthy();
    expect(screen.getByText("Replacement water valve and pipe fittings")).toBeTruthy();
    expect(screen.getByText(/INV-2026-441/)).toBeTruthy();
    expect(screen.getByText(/Fast decision:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByText(/Demo data:/)).toBeNull();
    expect(screen.getByText("Request progress")).toBeTruthy();
  });

  it("opens 6-digit approval PIN modal on Approve click and verifies PIN", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider initialLocale="en">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-101" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ramesh Hardware")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    // PIN modal appears
    const pinDialog = screen.getByRole("dialog");
    expect(pinDialog).toBeTruthy();
    expect(screen.getByText("Enter 6-digit approval PIN")).toBeTruthy();

    const pinInput = screen.getByLabelText("Approval PIN");
    await user.type(pinInput, "123456");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(screen.getByText("Expense successfully approved")).toBeTruthy();
    });

    expect(screen.getByText("This request has already been approved")).toBeTruthy();
  });

  it("opens rejection modal on Reject click, requires mandatory reason, and submits rejection", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider initialLocale="en">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-102" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Shakti Electricians")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Reject" }));

    // Rejection modal appears
    const rejectDialog = screen.getByRole("dialog");
    expect(rejectDialog).toBeTruthy();
    expect(screen.getByText("Reject expense request")).toBeTruthy();

    const reasonInput = screen.getByLabelText("Rejection reason");
    await user.type(reasonInput, "Not approved by executive committee");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() => {
      expect(screen.getByText("Expense has been rejected")).toBeTruthy();
    });

    expect(screen.getByText("This request has been rejected")).toBeTruthy();
  });

  it("shows already approved notice when expense is already settled", async () => {
    vi.spyOn(expenseService, "fetchExpenseItem").mockResolvedValueOnce({
      id: "exp-settled",
      fundId: "demo-fund",
      amountPaise: paise(80000),
      payeeName: "Vendor A",
      payeeUpi: "vendor@upi",
      purpose: "Completed work",
      status: "settled",
      requesterId: "usr-1",
      requesterName: "Treasurer",
      createdAt: "2026-10-28",
      approvals: [],
      requiredQuorum: 2,
    });

    render(
      <LocaleProvider initialLocale="en">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-settled" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("This request has already been approved")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("renders in Hindi when Hindi locale is active", async () => {
    render(
      <LocaleProvider initialLocale="hi">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-101" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ramesh Hardware")).toBeTruthy();
    });

    expect(screen.getAllByText("खर्च स्वीकृति अनुरोध").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "स्वीकार करें" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "अस्वीकार करें" })).toBeTruthy();
  });

  it("renders offline banner when client is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    render(
      <LocaleProvider initialLocale="en">
        <ApproverPage params={Promise.resolve({ fundId: "demo-fund", expenseId: "exp-101" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("You are working offline. Displaying cached data.")).toBeTruthy();
    });
  });
});
