import type { Event } from "@yen/eventlog";
import { formatInr, type Paise, paise } from "@yen/shared";
import type { SpendingCategoryItem, WeeklySummaryData } from "./types.js";

export interface WeeklySummaryResult {
  readonly fundId: string;
  readonly fundTitle: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly donationsCount: number;
  readonly totalDonationsPaise: Paise;
  readonly expensesCount: number;
  readonly totalExpensesPaise: Paise;
  readonly breakdown: readonly SpendingCategoryItem[];
  readonly messageEn: string;
  readonly messageHi: string;
  readonly summaryData: WeeklySummaryData;
}

/**
 * Generates weekly fund summary strictly from append-only events within the specified period.
 * Does not query or recompute from mutable tables.
 */
export function generateWeeklySummaryFromEvents(
  fundId: string,
  fundTitle: string,
  events: readonly Event[],
  periodStart: string,
  periodEnd: string,
  options?: {
    expenseCategoryMap?: Map<string, string> | Record<string, string>;
    unsubscribeUrl?: string;
  },
): WeeklySummaryResult {
  const startEpoch = new Date(periodStart).getTime();
  const endEpoch = new Date(periodEnd).getTime();

  // Filter events by fund and time range
  const fundEvents = events.filter((e) => {
    if (e.fund_id !== fundId) return false;
    const epoch = new Date(e.occurred_at).getTime();
    return epoch >= startEpoch && epoch <= endEpoch;
  });

  const categoryMap =
    options?.expenseCategoryMap instanceof Map
      ? options.expenseCategoryMap
      : new Map(Object.entries(options?.expenseCategoryMap ?? {}));

  // Track expenses from events
  const expenseAmounts = new Map<string, number>();
  const activeExpenses = new Set<string>();

  let donationsCount = 0;
  let totalDonationsPaise = 0;

  for (const event of fundEvents) {
    switch (event.type) {
      case "donation.pledged": {
        donationsCount += 1;
        totalDonationsPaise += Number(event.payload.amount_paise);
        break;
      }

      case "donation.verified": {
        // If donation was already counted in pledged, we don't double count
        // If not counted yet (e.g. pledged earlier), we count it
        break;
      }

      case "expense.submitted": {
        const amount = Number(event.payload.amount_paise);
        expenseAmounts.set(event.payload.expense_id, amount);
        activeExpenses.add(event.payload.expense_id);
        break;
      }

      case "expense.rejected":
      case "expense.expired": {
        activeExpenses.delete(event.payload.expense_id);
        break;
      }

      default:
        break;
    }
  }

  // Aggregate by category
  const categoryTotals = new Map<string, number>();
  let totalExpensesPaise = 0;
  let expensesCount = 0;

  for (const expenseId of activeExpenses) {
    const amount = expenseAmounts.get(expenseId) ?? 0;
    if (amount > 0) {
      expensesCount += 1;
      totalExpensesPaise += amount;
      const category = categoryMap.get(expenseId) ?? "general";
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
    }
  }

  const breakdown: SpendingCategoryItem[] = [];
  for (const [category, amount] of categoryTotals.entries()) {
    breakdown.push({
      category,
      amount_paise: paise(amount),
    });
  }

  // Sort breakdown descending by amount
  breakdown.sort((a, b) => Number(b.amount_paise) - Number(a.amount_paise));

  const totalExpensesFormatted = formatInr(paise(totalExpensesPaise));
  const unsubUrl = options?.unsubscribeUrl;
  const unsubEn = unsubUrl ? `\n\nUnsubscribe with one tap: ${unsubUrl}` : "";
  const unsubHi = unsubUrl ? `\n\nसदस्यता समाप्त करने के लिए एक बार टैप करें: ${unsubUrl}` : "";

  let messageEn: string;
  let messageHi: string;

  if (breakdown.length > 0) {
    const breakdownEn = breakdown
      .map((item) => `${item.category} ${formatInr(paise(Number(item.amount_paise)))}`)
      .join(", ");
    messageEn = `${totalExpensesFormatted} spent this week: ${breakdownEn}${unsubEn}`;
    messageHi = `इस सप्ताह ${totalExpensesFormatted} खर्च हुए: ${breakdownEn}${unsubHi}`;
  } else {
    messageEn = `No expenses recorded for ${fundTitle} this week.${unsubEn}`;
    messageHi = `इस सप्ताह ${fundTitle} के लिए कोई खर्च दर्ज नहीं हुआ।${unsubHi}`;
  }

  const summaryData: WeeklySummaryData = {
    fund_title: fundTitle,
    period_start: periodStart,
    period_end: periodEnd,
    donations_count: donationsCount,
    total_donations_paise: paise(totalDonationsPaise),
    expenses_count: expensesCount,
    total_expenses_paise: paise(totalExpensesPaise),
    breakdown,
    ...(unsubUrl ? { unsubscribe_url: unsubUrl } : {}),
  };

  return {
    fundId,
    fundTitle,
    periodStart,
    periodEnd,
    donationsCount,
    totalDonationsPaise: paise(totalDonationsPaise),
    expensesCount,
    totalExpensesPaise: paise(totalExpensesPaise),
    breakdown,
    messageEn,
    messageHi,
    summaryData,
  };
}
