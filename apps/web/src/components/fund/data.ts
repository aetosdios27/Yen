import { paise } from "@yen/shared";
import { getApiClient } from "../../lib/api-client";
import type {
  PublicFund,
  PublicTimelineEntry,
  SpendingCategory,
  SpendingCategoryId,
} from "./types";

const VALID_CATEGORIES: readonly SpendingCategoryId[] = [
  "equipment",
  "travel",
  "registration",
  "logistics",
  "food",
  "other",
];

export async function getPublicFund(fundId: string): Promise<PublicFund | null> {
  const client = getApiClient();

  try {
    const [summaryRes, breakdownRes, timelineRes] = await Promise.all([
      client.GET("/v1/funds/{fundId}/public/summary", {
        params: { path: { fundId } },
      }),
      client.GET("/v1/funds/{fundId}/public/breakdown", {
        params: { path: { fundId } },
      }),
      client.GET("/v1/funds/{fundId}/public/timeline", {
        params: { path: { fundId } },
      }),
    ]);

    if (summaryRes.response.status === 404 || !summaryRes.data) {
      return null;
    }

    const summary = summaryRes.data;
    const breakdown = breakdownRes.data;
    const timeline = timelineRes.data;

    const raisedPaise = summary.raisedPaise ? paise(Number(summary.raisedPaise)) : paise(0);
    const spentPaise = summary.spentPaise ? paise(Number(summary.spentPaise)) : paise(0);
    const currentBalance = paise(Math.max(0, raisedPaise - spentPaise));

    const totalBreakdown = (breakdown?.categories ?? []).reduce(
      (sum, cat) => sum + Number(cat.spentPaise),
      0,
    );

    const spendingCategories: SpendingCategory[] = (breakdown?.categories ?? []).map((cat) => {
      const catSpent = Number(cat.spentPaise);
      const percentage = totalBreakdown > 0 ? Math.round((catSpent * 100) / totalBreakdown) : 0;
      const rawCategory = cat.category.toLowerCase();
      const id: SpendingCategoryId = VALID_CATEGORIES.includes(rawCategory as SpendingCategoryId)
        ? (rawCategory as SpendingCategoryId)
        : "other";

      return {
        id,
        amount: paise(catSpent),
        percentage,
      };
    });

    const isFundVerified =
      summary.verification === "bank-matched" || summary.verification === "anchored";

    const timelineEntries: PublicTimelineEntry[] = (timeline?.items ?? []).map((item) => {
      const isItemVerified = item.verified === "bank-matched" || item.verified === "anchored";
      return {
        id: item.id,
        type: "expense",
        title: item.message,
        description: item.actorDisplayName,
        amount: item.amountPaise ? paise(Number(item.amountPaise)) : paise(0),
        dateTime: item.occurredAt,
        status: isItemVerified ? "verified" : "pending",
        verification: {
          status: isItemVerified ? "verified" : "pending",
        },
      };
    });

    return {
      id: summary.fundId,
      name: summary.name,
      purpose: summary.purpose ?? "",
      org: {
        id: summary.fundId,
        name: summary.name,
        verified: isFundVerified,
      },
      money: {
        totalRaised: raisedPaise,
        totalSpent: spentPaise,
        currentBalance,
      },
      spendingBreakdown: spendingCategories,
      timeline: timelineEntries,
    };
  } catch {
    return null;
  }
}
