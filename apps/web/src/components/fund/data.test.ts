import { afterEach, expect, it, vi } from "vitest";
import { getPublicFund } from "./data";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../lib/api-client", () => ({ getApiClient: () => ({ GET: get }) }));
afterEach(() => vi.resetAllMocks());

it.each(["unverified", "bank-matched", "anchored"])(
  "uses real totals, categories and donor labels while gating Verified for %s",
  async (verification) => {
    get.mockImplementation(async (path: string) => ({
      response: new Response(null, { status: 200 }),
      data: path.endsWith("summary")
        ? {
            fundId: "fund",
            name: "Community",
            purpose: null,
            raisedPaise: "7000",
            pledgedPaise: "9000",
            spentPaise: "2500",
            verification,
          }
        : path.endsWith("breakdown")
          ? { categories: [{ category: "Equipment", spentPaise: "2500" }] }
          : {
              items: [
                {
                  id: "item",
                  message: "A donation was bank matched.",
                  occurredAt: "2026-10-28T00:00:00.000Z",
                  amountPaise: "7000",
                  actorDisplayName: "A. S.",
                  verified: verification,
                },
              ],
            },
    }));
    const fund = await getPublicFund("fund");
    expect(fund?.org.verification).toBe(verification);
    expect(fund?.money).toEqual({ totalRaised: 7000, totalSpent: 2500, currentBalance: 4500 });
    expect(fund?.spendingBreakdown).toEqual([{ id: "equipment", amount: 2500, percentage: 100 }]);
    expect(fund?.timeline[0]).toMatchObject({
      description: "A. S.",
      status: verification === "anchored" ? "verified" : "pending",
    });
  },
);

it("keeps every API spending category in the public breakdown", async () => {
  get.mockImplementation(async (path: string) => ({
    response: new Response(null, { status: 200 }),
    data: path.endsWith("summary")
      ? { fundId: "fund", name: "Community", raisedPaise: "600", spentPaise: "600" }
      : path.endsWith("breakdown")
        ? {
            categories: ["Equipment", "Travel", "Catering", "Logistics", "Facilities", "Other"].map(
              (category) => ({ category, spentPaise: "100" }),
            ),
          }
        : { items: [] },
  }));
  const fund = await getPublicFund("fund");
  expect(fund?.spendingBreakdown.map((category) => category.id)).toEqual([
    "equipment",
    "travel",
    "food",
    "logistics",
    "facilities",
    "other",
  ]);
});
