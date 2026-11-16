import { paise } from "@yen/shared";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "./api-client";
import { fetchFundTreasurerData } from "./expense-service";

afterEach(() => {
  vi.unstubAllGlobals();
  setApiClient(null);
});
function respond(balancesStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const balances = request.url.endsWith("/balances");
      const data = balances
        ? balancesStatus === 200
          ? { bankPaise: "375000", reservedPaise: "10000", availablePaise: "365000" }
          : { error: { message: "Ledger unavailable" } }
        : request.url.includes("/summary")
          ? { fundId: "fund-1", name: "Robotics", raisedPaise: "500000", spentPaise: "125000" }
          : [
              {
                id: "approved",
                fundId: "fund-1",
                amountPaise: "10000",
                status: "approved",
                holdId: "hold-1",
              },
              { id: "draft", fundId: "fund-1", amountPaise: "50000", status: "draft" },
              { id: "paid", fundId: "fund-1", amountPaise: "125000", status: "paid" },
            ];
      return new Response(JSON.stringify(data), {
        status: balances ? balancesStatus : 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}
it("uses ledger money, excludes unreserved drafts from reservations and retains approved work", async () => {
  respond();
  const data = await fetchFundTreasurerData("fund-1");
  expect(data.totalBalancePaise).toBe(paise(375000));
  expect(data.spendableBalancePaise).toBe(paise(365000));
  expect(data.pendingExpenses.map((expense) => expense.id)).toEqual(["approved", "draft"]);
});
it("fails visibly when ledger balances cannot be read instead of inventing spendable money", async () => {
  respond(503);
  await expect(fetchFundTreasurerData("fund-1")).rejects.toThrow("Ledger unavailable");
});
