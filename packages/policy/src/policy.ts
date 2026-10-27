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

/**
 * Calculates the required approval quorum for an expense based on the fund policy
 * and spend threshold rules.
 */
export function requiredQuorumForExpense(policy: FundPolicy, amountPaise: Paise): number {
  let quorum = Math.max(1, policy.approvalQuorum);
  if (policy.spendThresholds) {
    for (const rule of policy.spendThresholds) {
      if (amountPaise >= rule.minAmountPaise) {
        quorum = Math.max(quorum, rule.requiredQuorum);
      }
    }
  }
  return quorum;
}
