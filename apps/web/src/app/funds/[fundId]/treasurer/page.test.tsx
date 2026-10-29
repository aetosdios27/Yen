import { render, screen, waitFor } from "@testing-library/react";
import { paise } from "@yen/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../../../i18n";
import * as apiClientModule from "../../../../lib/api-client";
import * as expenseService from "../../../../lib/expense-service";
import TreasurerPage from "./page";

describe("TreasurerPage", () => {
  beforeEach(() => {
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      GET: vi.fn().mockImplementation((path: string) => {
        if (path.includes("/summary")) {
          return Promise.resolve({
            response: { status: 200 },
            data: {
              fundId: "demo-fund",
              name: "Greenwood Residents Fund",
              raisedPaise: "500000",
              spentPaise: "0",
              verification: "bank-matched",
              dataGaps: [],
            },
          });
        }
        if (path.includes("/expenses")) {
          return Promise.resolve({
            response: { status: 200 },
            data: [
              {
                id: "exp-101",
                fundId: "demo-fund",
                amountPaise: "45000",
                description: "Replacement water valve and pipe fittings",
                recipientRef: "Ramesh Hardware (ramesh@upi)",
                status: "submitted",
                evidence: [{ evidenceId: "evi-2026-4410" }],
                approvalsCount: 1,
                approvals: [
                  {
                    approverId: "usr-appr-1",
                    approverName: "Asha Rao",
                    approvedAt: "2026-10-28 10:15 AM",
                  },
                ],
                createdAt: "2026-10-28 09:30 AM",
                submittedAt: "2026-10-28 09:35 AM",
              },
              {
                id: "exp-102",
                fundId: "demo-fund",
                amountPaise: "120000",
                description: "Rewiring main courtyard breaker box",
                recipientRef: "Shakti Electricians (shakti@okhdfcbank)",
                status: "submitted",
                evidence: [{ evidenceId: "evi-89020000" }],
                approvalsCount: 0,
                approvals: [],
                createdAt: "2026-10-28 11:00 AM",
                submittedAt: "2026-10-28 11:05 AM",
              },
            ],
          });
        }
        return Promise.resolve({ response: { status: 404 } });
      }),
      POST: vi.fn(),
    } as unknown as apiClientModule.YenClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders balances, pending expense count, and pending requests list", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <TreasurerPage params={Promise.resolve({ fundId: "demo-fund" })} />
      </LocaleProvider>,
    );

    // Initial loading indicator
    expect(screen.getByRole("status")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Total balance")).toBeTruthy();
    });

    expect(screen.getByText("Treasurer dashboard")).toBeTruthy();
    expect(screen.getByText("Spendable balance")).toBeTruthy();
    expect(screen.getByText("Pending expenses")).toBeTruthy();
    expect(screen.getByText("Ramesh Hardware")).toBeTruthy();
    expect(screen.getByText("Shakti Electricians")).toBeTruthy();
    expect(screen.getAllByText("New Expense").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Demo data:/)).toBeNull();
  });

  it("renders live dashboard data without demo banner in Hindi", async () => {
    render(
      <LocaleProvider initialLocale="hi">
        <TreasurerPage params={Promise.resolve({ fundId: "demo-fund" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("खजांची डैशबोर्ड")).toBeTruthy();
    });
    expect(screen.queryByText(/डेमो डेटा/)).toBeNull();
  });

  it("renders graceful empty state when there are no pending expenses", async () => {
    vi.spyOn(expenseService, "fetchFundTreasurerData").mockResolvedValueOnce({
      fundId: "empty-fund",
      fundName: "Empty Fund",
      totalBalancePaise: paise(100000),
      spendableBalancePaise: paise(100000),
      pendingExpenses: [],
    });

    render(
      <LocaleProvider initialLocale="en">
        <TreasurerPage params={Promise.resolve({ fundId: "empty-fund" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("No pending expenses")).toBeTruthy();
    });

    expect(
      screen.getByText("When an expense request is drafted or submitted, it will appear here."),
    ).toBeTruthy();
  });

  it("renders graceful error state with retry button on fetch failure", async () => {
    vi.spyOn(expenseService, "fetchFundTreasurerData").mockRejectedValueOnce(
      new Error("Network connection error"),
    );

    render(
      <LocaleProvider initialLocale="en">
        <TreasurerPage params={Promise.resolve({ fundId: "error-fund" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    expect(screen.getByText("Could not load dashboard")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders in Hindi when Hindi locale is active", async () => {
    render(
      <LocaleProvider initialLocale="hi">
        <TreasurerPage params={Promise.resolve({ fundId: "demo-fund" })} />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("कुल शेष")).toBeTruthy();
    });

    expect(screen.getByText("खजांची डैशबोर्ड")).toBeTruthy();
    expect(screen.getByText("खर्च योग्य शेष")).toBeTruthy();
    expect(screen.getByText("लंबित खर्च")).toBeTruthy();
  });
});
