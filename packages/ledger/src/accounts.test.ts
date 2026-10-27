import { describe, expect, it } from "vitest";
import {
  deterministicUuid,
  fundAccountId,
  fundAccountName,
  getFundAccountIds,
} from "./accounts.js";

const UUID_V5_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministic accounts", () => {
  const fundA = "0194ebc4-94e8-7000-8000-000000000001";
  const fundB = "0194ebc4-94e8-7000-8000-000000000002";

  it("generates valid RFC 4122 v5 UUIDs", () => {
    const id = deterministicUuid("namespace", "test-account");
    expect(id).toMatch(UUID_V5_REGEX);
  });

  it("generates reproducible IDs for the same fund and kind", () => {
    const bank1 = fundAccountId(fundA, "bank");
    const bank2 = fundAccountId(fundA, "bank");
    expect(bank1).toBe(bank2);
    expect(bank1).toMatch(UUID_V5_REGEX);
  });

  it("generates distinct IDs for different kinds within the same fund", () => {
    const accounts = getFundAccountIds(fundA);
    const set = new Set([
      accounts.bankId,
      accounts.donationsId,
      accounts.expensesId,
      accounts.pendingSpendId,
    ]);
    expect(set.size).toBe(4);
    for (const id of set) {
      expect(id).toMatch(UUID_V5_REGEX);
    }
  });

  it("generates distinct IDs across different funds", () => {
    const bankA = fundAccountId(fundA, "bank");
    const bankB = fundAccountId(fundB, "bank");
    expect(bankA).not.toBe(bankB);
  });

  it("formats account names with fund prefix and kind", () => {
    expect(fundAccountName(fundA, "bank")).toBe(`fund:${fundA}:bank`);
    expect(fundAccountName(fundA, "donations")).toBe(`fund:${fundA}:donations`);
    expect(fundAccountName(fundA, "expenses")).toBe(`fund:${fundA}:expenses`);
    expect(fundAccountName(fundA, "pending_spend")).toBe(`fund:${fundA}:pending_spend`);
  });
});
