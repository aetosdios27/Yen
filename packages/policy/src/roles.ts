import type { PseudonymId, UserId } from "@yen/shared";

/**
 * The six fund roles recognized by the Yen policy engine:
 * - owner: fund creator/administrator with full governance privileges
 * - treasurer: manages spending proposals, evidence, payouts, and bank reconciliation
 * - approver: verifies and votes on expense requests
 * - auditor: inspects tamper-evident logs, flags concerns, resolves objections
 * - donor: contributes funds, monitors spending, raises objections during window
 * - public: unauthenticated or general public viewer
 */
export const FUND_ROLES = ["owner", "treasurer", "approver", "auditor", "donor", "public"] as const;

export type FundRole = (typeof FUND_ROLES)[number];

export interface Actor {
  readonly id?: PseudonymId | UserId | string | undefined;
  readonly role: FundRole;
  readonly roles?: readonly FundRole[] | undefined;
}

export function hasRole(actor: Actor, role: FundRole): boolean {
  if (actor.role === role) return true;
  if (actor.roles?.includes(role)) return true;
  return false;
}

export function isStaffRole(role: FundRole): boolean {
  return role === "owner" || role === "treasurer" || role === "approver" || role === "auditor";
}

export function isMemberRole(role: FundRole): boolean {
  return isStaffRole(role);
}
