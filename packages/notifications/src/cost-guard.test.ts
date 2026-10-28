import { paise, parseFundId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  checkDailyCap,
  type DailyFundUsage,
  DEFAULT_DAILY_NOTIFICATION_CAP,
  getTodayDateString,
  incrementUsage,
} from "./cost-guard.js";

describe("Cost Guard & Daily Caps", () => {
  const fundResult = parseFundId("22222222-2222-7222-8222-222222222222");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;

  it("permits sends within daily cap", () => {
    const usage: DailyFundUsage = {
      fund_id: fundId,
      usage_date: "2026-10-28",
      sent_count: 50,
      total_cost_paise: paise(1500),
      cap_count: DEFAULT_DAILY_NOTIFICATION_CAP,
    };

    const check = checkDailyCap(usage);
    expect(check.allowed).toBe(true);
  });

  it("blocks sends when cap count is reached or exceeded", () => {
    const usage: DailyFundUsage = {
      fund_id: fundId,
      usage_date: "2026-10-28",
      sent_count: 100,
      total_cost_paise: paise(3000),
      cap_count: 100,
    };

    const check = checkDailyCap(usage);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Daily notification cap (100) exceeded");
  });

  it("increments message count and paise cost using Paise arithmetic", () => {
    const initial: DailyFundUsage = {
      fund_id: fundId,
      usage_date: "2026-10-28",
      sent_count: 0,
      total_cost_paise: paise(0),
      cap_count: 100,
    };

    const afterOne = incrementUsage(initial, paise(30));
    expect(afterOne.sent_count).toBe(1);
    expect(afterOne.total_cost_paise).toBe(30);

    const afterTwo = incrementUsage(afterOne, paise(15));
    expect(afterTwo.sent_count).toBe(2);
    expect(afterTwo.total_cost_paise).toBe(45);
  });

  it("returns YYYY-MM-DD date string for today", () => {
    const dateStr = getTodayDateString(new Date("2026-10-28T14:00:00Z"), "UTC");
    expect(dateStr).toBe("2026-10-28");
  });
});
