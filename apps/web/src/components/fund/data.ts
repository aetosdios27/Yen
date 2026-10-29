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

    const raisedPaise = summary.raisedPaise ? paise(BigInt(summary.raisedPaise)) : paise(0n);
    const spentPaise = summary.spentPaise ? paise(BigInt(summary.spentPaise)) : paise(0n);
    const currentBalance = paise(raisedPaise > spentPaise ? raisedPaise - spentPaise : 0n);

    const totalBreakdown = (breakdown?.categories ?? []).reduce(
      (sum, cat) => sum + BigInt(cat.spentPaise),
      0n,
    );

    const spendingCategories: SpendingCategory[] = (breakdown?.categories ?? []).map((cat) => {
      const catSpent = BigInt(cat.spentPaise);
      const percentage =
        totalBreakdown > 0n ? Math.round(Number((catSpent * 100n) / totalBreakdown)) : 0;
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

    const timelineEntries: PublicTimelineEntry[] = (timeline?.items ?? []).map((item) => ({
      id: item.id,
      type: "expense",
      title: item.message,
      description: item.actorDisplayName,
      amount: item.amountPaise ? paise(BigInt(item.amountPaise)) : paise(0n),
      dateTime: item.occurredAt,
      status: item.verified !== "unverified" ? "verified" : "pending",
      verification: {
        status: item.verified !== "unverified" ? "verified" : "pending",
      },
    }));

    return {
      id: summary.fundId,
      name: summary.name,
      purpose: summary.purpose ?? "",
      org: {
        id: `org_${summary.fundId}`,
        name: summary.name,
        verified: summary.verification !== "unverified",
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
