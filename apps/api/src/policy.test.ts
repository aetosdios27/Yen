import { describe, expect, it } from "vitest";
import { devPolicy } from "./policy.js";

const fund = {
  owner: "00000000-0000-4000-8000-000000000001",
  fund: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Festival",
    targetPaise: "1000",
    createdAt: "2026-10-28T00:00:00.000Z",
  },
} as const;

describe("evidence policy adapter", () => {
  it("delegates owner access to @yen/policy and denies a viewer from another fund", () => {
    const resource = {
      kind: "expense",
      fund,
      expenseId: "00000000-0000-4000-8000-000000000011",
    } as const;
    expect(devPolicy.can({ id: fund.owner }, "expense:add_evidence", resource)).toBe(true);
    expect(
      devPolicy.can(
        { id: "00000000-0000-4000-8000-000000000002" },
        "expense:add_evidence",
        resource,
      ),
    ).toBe(false);
  });

  it("fails closed when authorization inputs are malformed", () => {
    expect(
      devPolicy.can({ id: fund.owner }, "expense:add_evidence", {
        kind: "expense",
        fund: { ...fund, fund: { ...fund.fund, id: "../../other-fund" } },
        expenseId: "00000000-0000-4000-8000-000000000011",
      }),
    ).toBe(false);
  });
});
