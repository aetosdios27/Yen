import type { PseudonymId, UserId } from "@yen/shared";

/**
 * The seven fund roles recognized by the Yen policy engine:
 * - owner: fund creator/administrator with full governance privileges
 * - treasurer: manages spending proposals, evidence, payouts, and bank reconciliation
 * - approver: verifies and votes on expense requests
 * - auditor: inspects tamper-evident logs, flags concerns, resolves objections
 * - donor: contributes funds, monitors spending, raises objections during window
 * - member: fund participant with read access to member-visible information
 * - public: unauthenticated or general public viewer
 */
export const FUND_ROLES = [
  "owner",
  "treasurer",
  "approver",
  "auditor",
  "donor",
  "member",
  "public",
] as const;

export type FundRole = (typeof FUND_ROLES)[number];

const FUND_ROLES_SET = new Set<string>(FUND_ROLES);

export function isValidRole(role: unknown): role is FundRole {
  return typeof role === "string" && FUND_ROLES_SET.has(role);
}

export interface Actor {
  readonly id?: PseudonymId | UserId | string | undefined;
  readonly role: FundRole;
  readonly roles?: readonly FundRole[] | undefined;
}

/**
 * The actor's primary role plus any valid secondary roles. Unknown runtime values
 * (for example "toString" or "__proto__") are dropped, never treated as roles.
 */
export function actorRoles(actor: Actor): readonly FundRole[] {
  const secondary = Array.isArray(actor.roles) ? actor.roles.filter(isValidRole) : [];
  return isValidRole(actor.role) ? [actor.role, ...secondary] : secondary;
}

export function hasRole(actor: Actor, role: FundRole): boolean {
  return actorRoles(actor).includes(role);
}

export function isStaffRole(role: FundRole): boolean {
  return role === "owner" || role === "treasurer" || role === "approver" || role === "auditor";
}

export function isMemberRole(role: FundRole): boolean {
  return role === "member" || isStaffRole(role);
}
