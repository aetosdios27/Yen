import { addPaise, type FundId, type Paise } from "@yen/shared";

export const DEFAULT_DAILY_NOTIFICATION_CAP = 100;

export interface DailyFundUsage {
  fund_id: FundId;
  usage_date: string;
  sent_count: number;
  total_cost_paise: Paise;
  cap_count: number;
}

export function getTodayDateString(now: Date = new Date(), timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // Returns YYYY-MM-DD
}

export function checkDailyCap(usage: DailyFundUsage): { allowed: boolean; reason?: string } {
  if (usage.sent_count >= usage.cap_count) {
    return {
      allowed: false,
      reason: `Daily notification cap (${usage.cap_count}) exceeded for fund`,
    };
  }
  return { allowed: true };
}

export function incrementUsage(usage: DailyFundUsage, costPaise: Paise): DailyFundUsage {
  return {
    ...usage,
    sent_count: usage.sent_count + 1,
    total_cost_paise: addPaise(usage.total_cost_paise, costPaise),
  };
}
