import { act, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../../i18n";
import { setApiClient } from "../../../lib/api-client";
import NewExpensePage from "./expenses/new/page";
import TreasurerPage from "./treasurer/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  setApiClient(null);
});
function approverSession() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      const data = url.endsWith("/me/funds")
        ? { funds: [{ id: "fund-1", title: "Robotics", role: "approver", visibility: "public" }] }
        : url.endsWith("/me")
          ? { displayName: "Priya Verma" }
          : url.endsWith("/summary")
            ? { name: "Robotics" }
            : url.endsWith("/balances")
              ? { bankPaise: "500000", reservedPaise: "0", availablePaise: "500000" }
              : [];
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}
it("never shows expense creation to an approver on the old treasurer URL", async () => {
  approverSession();
  render(
    <LocaleProvider>
      <TreasurerPage params={Promise.resolve({ fundId: "fund-1" })} />
    </LocaleProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Expenses awaiting completion",
    ),
  );
  expect(screen.queryByRole("link", { name: "New Expense" })).toBeNull();
});
it("blocks an approver who opens the creation URL directly", async () => {
  approverSession();
  await act(async () => {
    render(
      <LocaleProvider>
        <Suspense fallback="Loading">
          <NewExpensePage params={Promise.resolve({ fundId: "fund-1" })} />
        </Suspense>
      </LocaleProvider>,
    );
  });
  expect(
    await screen.findByText("Only the fund owner or treasurer can create expenses."),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Amount (₹)")).toBeNull();
});
