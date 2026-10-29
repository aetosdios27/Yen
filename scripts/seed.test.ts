import { SEED_CONSTANTS } from "@yen/db";
import { formatInr, paise } from "@yen/shared";
import { describe, expect, it } from "vitest";

describe("seed script verification", () => {
  it("exports valid deterministic IDs for reproducible seed runs", () => {
    expect(SEED_CONSTANTS.fundId).toBe("01940000-0000-7000-8000-000000000002");
    expect(SEED_CONSTANTS.orgId).toBe("01940000-0000-7000-8000-000000000001");
  });

  it("calculates money amounts strictly in paise without floating point issues", () => {
    const donation1 = paise(20000000); // ₹2,00,000
    const donation2 = paise(20000000); // ₹2,00,000
    const donation3 = paise(10000000); // ₹1,00,000
    const totalDonations = paise(donation1 + donation2 + donation3);
    expect(totalDonations).toBe(50000000);
    expect(formatInr(totalDonations)).toBe("₹5,00,000.00");

    const expense1 = paise(7500000); // ₹75,000
    const expense2 = paise(2500000); // ₹25,000
    const expense3 = paise(3500000); // ₹35,000
    expect(formatInr(expense1)).toBe("₹75,000.00");
    expect(formatInr(expense2)).toBe("₹25,000.00");
    expect(formatInr(expense3)).toBe("₹35,000.00");

    const remainingBalance = paise(totalDonations - expense3);
    expect(remainingBalance).toBe(46500000);
    expect(formatInr(remainingBalance)).toBe("₹4,65,000.00");
  });
});
