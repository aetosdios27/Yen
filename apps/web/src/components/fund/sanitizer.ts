import { type Paise, paise } from "@yen/shared";
import type {
  PublicEvidence,
  PublicFund,
  PublicTimelineEntry,
  RawFundRecord,
  SpendingCategory,
  SpendingCategoryId,
} from "./types";

function toPaise(value: bigint | string | number | undefined): Paise {
  if (value === undefined) {
    return paise(0);
  }
  if (typeof value === "number") {
    return paise(Math.floor(value));
  }
  if (typeof value === "bigint") {
    return paise(Number(value));
  }
  const parsed = Number.parseInt(String(value), 10);
  return paise(Number.isNaN(parsed) ? 0 : parsed);
}

function normalizeCategory(category: string | undefined): SpendingCategoryId {
  const norm = category?.toLowerCase().trim() ?? "";
  if (norm.includes("equip") || norm.includes("hardw") || norm.includes("motor")) {
    return "equipment";
  }
  if (
    norm.includes("travel") ||
    norm.includes("train") ||
    norm.includes("flight") ||
    norm.includes("cab")
  ) {
    return "travel";
  }
  if (norm.includes("reg") || norm.includes("fee") || norm.includes("ticket")) {
    return "registration";
  }
  if (norm.includes("logis") || norm.includes("shipp") || norm.includes("materi")) {
    return "logistics";
  }
  if (norm.includes("food") || norm.includes("cater") || norm.includes("refresh")) {
    return "food";
  }
  return "other";
}

/**
 * Strips all internal, private, and PII fields (phone numbers, bank accounts,
 * user/approver UUIDs, internal identifiers) before returning public data.
 */
export function sanitizePublicFund(raw: RawFundRecord): PublicFund {
  const totalRaised = toPaise(raw.total_raised_paise);
  const totalSpent = toPaise(raw.total_spent_paise);
  const balanceRaw = totalRaised - totalSpent;
  const currentBalance = paise(Math.max(balanceRaw, 0));

  const categories: SpendingCategory[] = (raw.spending_categories ?? []).map((cat) => {
    const amount = toPaise(cat.amount_paise);
    const percentage =
      totalSpent > 0 ? Math.min(100, Math.max(0, Math.round((amount * 100) / totalSpent))) : 0;
    return {
      id: normalizeCategory(cat.category),
      amount,
      percentage,
    };
  });

  const timeline: PublicTimelineEntry[] = (raw.timeline ?? []).map((entry) => {
    const amount = toPaise(entry.amount_paise);
    const category = entry.type === "expense" ? normalizeCategory(entry.category) : undefined;
    const status = entry.status === "verified" ? "verified" : "pending";

    const evidence: PublicEvidence | undefined = entry.evidence
      ? {
          id: entry.evidence.id,
          title: entry.evidence.title ?? "Invoice / Receipt",
          url: entry.evidence.url ?? `/evidence/${entry.evidence.id}`,
        }
      : undefined;

    const approverCount = entry.approver_ids ? entry.approver_ids.length : undefined;

    return {
      id: entry.id,
      type: entry.type,
      title: entry.title ?? (entry.type === "donation" ? "Donation" : "Expense"),
      description: entry.description,
      amount,
      dateTime: entry.occurred_at ?? entry.created_at ?? new Date().toISOString(),
      category,
      status,
      // Public pseudonym / display name only; phone or user ID stripped
      donorName:
        entry.donor_name ?? (entry.type === "donation" ? "Community supporter" : undefined),
      evidence,
      verification: {
        status,
        recordProofUrl: entry.proof_url ?? `/records/proof/${entry.id}`,
        intervalRootHex: entry.merkle_root,
        confirmedAt: entry.occurred_at,
        approverCount,
      },
    };
  });

  return {
    id: raw.id,
    name: raw.name ?? raw.title ?? "Public Fund",
    purpose: raw.purpose ?? raw.description ?? "Community transparency fund",
    org: {
      id: raw.org.id,
      name: raw.org.name,
      verified: Boolean(raw.org.verified ?? true),
      legalForm: raw.org.legal_form,
    },
    money: {
      totalRaised,
      totalSpent,
      currentBalance,
    },
    spendingBreakdown: categories,
    timeline,
    upiPayee: raw.upi_vpa
      ? {
          vpa: raw.upi_vpa,
          payeeName: raw.upi_payee_name ?? raw.org.name,
        }
      : undefined,
  };
}
