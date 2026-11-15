import { paise } from "@yen/shared";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "./api-client";
import { fetchFundTreasurerData } from "./expense-service";

afterEach(() => {
  vi.unstubAllGlobals();
  setApiClient(null);
});

it("subtracts recorded spending from the displayed fund balance", async () => {
  setApiClient(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const data = request.url.includes("/summary")
        ? { fundId: "fund-1", name: "Robotics", raisedPaise: "500000", spentPaise: "125000" }
        : [];
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const data = await fetchFundTreasurerData("fund-1");
  expect(data.totalBalancePaise).toBe(paise(375000));
  expect(data.spendableBalancePaise).toBe(paise(375000));
});
