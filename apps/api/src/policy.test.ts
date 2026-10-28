import { expect, it } from "vitest";
import { devPolicy } from "./policy.js";

const fund = (id: string) => ({ kind: "fund" as const, fund: { owner: "owner", fund: { id } } });

it("uses the shared policy engine to allow public donation pledges", () => {
  expect(devPolicy.canDonate(fund("00000000-0000-4000-8000-000000000001"))).toBe(true);
});

it("fails closed when the donation fund resource is malformed", () => {
  expect(devPolicy.canDonate(fund("not-a-fund-id"))).toBe(false);
});
