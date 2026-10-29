import { parsePseudonymId } from "@yen/eventlog";
import { expect, it } from "vitest";
import type { ExpenseObjection } from "./expense-objections.js";
import { redactObjectionList } from "./objection-routes.js";

const objections: ExpenseObjection[] = [
  {
    id: "01940000-0000-7000-8000-000000000001",
    expenseId: "01940000-0000-7000-8000-000000000002",
    actorId: parsePseudonymId("psn_01940000-0000-7000-8000-000000000003"),
    reason: "Need the receipt",
    createdAt: "2026-10-29T10:00:00.000Z",
    resolution: null,
    resolutionReason: null,
  },
];

it("returns only objection counts to the public", () => {
  expect(redactObjectionList("public", objections)).toEqual({ count: 1, openCount: 1 });
});

it("hides reasons from donors and exposes them to member tiers", () => {
  const donor = redactObjectionList("donor", objections);
  expect(donor.objections?.[0]).not.toHaveProperty("reason");
  const member = redactObjectionList("member", objections);
  expect(member.objections?.[0]?.reason).toBe("Need the receipt");
});
