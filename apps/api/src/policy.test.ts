import { describe, expect, it } from "vitest";
import { devPolicy } from "./policy.js";

const fund = (id: string) => ({
  kind: "fund" as const,
  fund: {
    owner: "owner",
    fund: {
      id,
      name: "Test Fund",
      targetPaise: "10000",
      upiVpa: "test@yenbank",
      upiPayeeName: "Test Fund",
      createdAt: "2026-01-01T00:00:00.000Z",
      visibility: "private" as const,
    },
  },
});

it("uses the shared policy engine to allow public donation pledges", () => {
  expect(devPolicy.canDonate(fund("00000000-0000-4000-8000-000000000001"))).toBe(true);
});

it("fails closed when the donation fund resource is malformed", () => {
  expect(devPolicy.canDonate(fund("not-a-fund-id"))).toBe(false);
});

const evidenceFund = {
  owner: "00000000-0000-4000-8000-000000000001",
  fund: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Festival",
    targetPaise: "1000",
    upiVpa: "festival@yenbank",
    upiPayeeName: "Festival Committee",
    createdAt: "2026-10-28T00:00:00.000Z",
    visibility: "private" as const,
  },
} as const;

describe("evidence policy adapter", () => {
  it("delegates owner access to @yen/policy and denies a viewer from another fund", () => {
    const resource = {
      kind: "expense",
      fund: evidenceFund,
      expenseId: "00000000-0000-4000-8000-000000000011",
    } as const;
    expect(devPolicy.can({ id: evidenceFund.owner }, "expense:add_evidence", resource)).toBe(true);
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
      devPolicy.can({ id: evidenceFund.owner }, "expense:add_evidence", {
        kind: "expense",
        fund: { ...evidenceFund, fund: { ...evidenceFund.fund, id: "../../other-fund" } },
        expenseId: "00000000-0000-4000-8000-000000000011",
      }),
    ).toBe(false);
  });
});
