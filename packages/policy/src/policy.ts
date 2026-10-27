import type { FundId, Paise } from "@yen/shared";

/**
 * Visibility tiers per fund:
 * - public: visible to everyone (with public masking/redaction)
 * - donors: visible to verified donors, members, and administrators
 * - members: visible only to fund staff and internal members
 * - private: visible only to fund administrative staff (owner, treasurer, approver, auditor)
 */
export const VISIBILITY_TIERS = ["public", "donors", "members", "private"] as const;
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number];

const VISIBILITY_TIERS_SET = new Set<string>(VISIBILITY_TIERS);

export function isValidVisibilityTier(tier: unknown): tier is VisibilityTier {
  return typeof tier === "string" && VISIBILITY_TIERS_SET.has(tier);
}

export interface SpendThresholdRule {
  readonly minAmountPaise: Paise;
  readonly requiredQuorum: number;
}

export interface FundPolicy {
  readonly fundId?: FundId;
  readonly visibilityTier: VisibilityTier;
  readonly approvalQuorum: number; // M of N approvers (M >= 1)
  readonly spendThresholds?: readonly SpendThresholdRule[];
  readonly objectionWindowHours?: number;
}

export const DEFAULT_FUND_POLICY: FundPolicy = {
  visibilityTier: "members",
  approvalQuorum: 2,
  spendThresholds: [],
  objectionWindowHours: 48,
};

/** A money amount in paise: a safe, non-negative integer number. Never a float, string, or bigint. */
export function isValidPaiseAmount(amount: unknown): amount is Paise {
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0;
}

/** A quorum: a finite, positive integer. NaN, 0, negatives, fractions and Infinity are rejected. */
export function isValidQuorum(quorum: unknown): quorum is number {
  return typeof quorum === "number" && Number.isSafeInteger(quorum) && quorum >= 1;
}

export function isValidFundPolicy(policy: unknown): policy is FundPolicy {
  if (!policy || typeof policy !== "object") return false;
  const p = policy as Partial<FundPolicy>;
  if (!isValidVisibilityTier(p.visibilityTier)) return false;
  if (!isValidQuorum(p.approvalQuorum)) return false;
  if (p.spendThresholds !== undefined) {
    if (!Array.isArray(p.spendThresholds)) return false;
    for (const rule of p.spendThresholds) {
      if (!rule || typeof rule !== "object") return false;
      if (!isValidQuorum(rule.requiredQuorum)) return false;
      if (!isValidPaiseAmount(rule.minAmountPaise)) return false;
    }
  }
  if (p.objectionWindowHours !== undefined) {
    if (
      typeof p.objectionWindowHours !== "number" ||
      !Number.isSafeInteger(p.objectionWindowHours) ||
      p.objectionWindowHours < 0
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Calculates the required approval quorum for an expense based on the fund policy
 * and spend threshold rules.
 * Throws a TypeError if the policy contains an invalid quorum.
 */
export function requiredQuorumForExpense(policy: FundPolicy, amountPaise: Paise): number {
  if (!isValidFundPolicy(policy)) {
    throw new TypeError("Invalid fund policy: approvalQuorum must be a finite positive integer");
  }
  let quorum = policy.approvalQuorum;
  if (policy.spendThresholds) {
    for (const rule of policy.spendThresholds) {
      if (amountPaise >= rule.minAmountPaise) {
        quorum = Math.max(quorum, rule.requiredQuorum);
      }
    }
  }
  return quorum;
}
