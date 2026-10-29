import type { Paise } from "@yen/shared";
import { ACTION_RESOURCE_MAP, type Action, isValidAction } from "./actions.js";
import { isActionAllowedForRole } from "./matrix.js";
import {
  type FundPolicy,
  isValidFundPolicy,
  isValidPaiseAmount,
  isValidVisibilityTier,
  requiredQuorumForExpense,
  type VisibilityTier,
} from "./policy.js";
import {
  type ApprovalRecord,
  type ExpenseResourceData,
  isValidExpenseStatus,
  type Resource,
} from "./resources.js";
import {
  type Actor,
  actorRoles,
  type FundRole,
  hasRole,
  isStaffRole,
  isValidRole,
} from "./roles.js";

/** Trimmed identity string, or "" for anything that is not a string. */
function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isWellFormedActor(actor: unknown): actor is Actor {
  if (!actor || typeof actor !== "object") return false;
  const a = actor as Partial<Actor>;
  return (
    isValidRole(a.role) &&
    (a.roles === undefined || (Array.isArray(a.roles) && a.roles.every(isValidRole)))
  );
}

function isWellFormedFund(fund: unknown): boolean {
  return (
    !!fund && typeof fund === "object" && isValidFundPolicy((fund as { policy?: unknown }).policy)
  );
}

function isWellFormedExpense(expense: unknown): expense is ExpenseResourceData {
  if (!expense || typeof expense !== "object") return false;
  const e = expense as Partial<ExpenseResourceData>;
  return (
    isValidFundPolicy(e.policy) &&
    isValidPaiseAmount(e.amountPaise) &&
    normalizeId(e.requesterId) !== "" &&
    (e.status === undefined || isValidExpenseStatus(e.status)) &&
    (e.approvals === undefined || Array.isArray(e.approvals)) &&
    (e.objectionWindowOpen === undefined || typeof e.objectionWindowOpen === "boolean")
  );
}

/**
 * Validates whether an actor may perform an action based purely on role assignments.
 * Deny by default: If neither the actor's primary role nor any secondary roles allow
 * the action, this returns false immediately.
 */
export function roleMayPerform(actor: Actor, action: Action): boolean {
  if (!isWellFormedActor(actor) || !isValidAction(action)) {
    return false;
  }
  return actorRoles(actor).some((role) => isActionAllowedForRole(role, action));
}

/**
 * Pure authorization policy evaluation engine:
 * Evaluates whether an actor can perform an action on a specific resource.
 *
 * Core security principles:
 * 1. Deny by default: Any action/role pair not explicitly granted returns false.
 *    Malformed, missing or inconsistent input (unknown role, action/resource mismatch,
 *    invalid policy or amount, unknown expense status) also returns false.
 * 2. Separation of duties:
 *    - The requester cannot approve their own request (OWASP Transaction Authorization Cheat Sheet).
 *      https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
 *    - The treasurer cannot be the sole approver (OWASP Transaction Authorization Cheat Sheet).
 *      https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
 * 3. Visibility tier enforcement:
 *    - public: visible to all roles
 *    - donors: visible to donors, members, and administrative staff
 *    - members: visible to fund members and administrative staff
 *    - private: visible only to administrative staff (owner, treasurer, approver, auditor)
 *      OWASP Top 10 API Security Risks 2023 - API1:2023 Broken Object Level Authorization
 *      https://api-security.owasp.org/editions/2023/en/0x11-t10/
 * 4. Evidence tamper resistance:
 *    - Evidence cannot be added once the recorded approvals satisfy the policy (Threat E4).
 */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  if (
    !isWellFormedActor(actor) ||
    !isValidAction(action) ||
    !resource ||
    typeof resource !== "object"
  ) {
    return false;
  }

  // Each action belongs to exactly one resource kind (see ACTION_RESOURCE_MAP).
  if (resource.kind !== ACTION_RESOURCE_MAP[action]) {
    return false;
  }

  if (!roleMayPerform(actor, action)) {
    return false;
  }

  const roles = actorRoles(actor);

  switch (resource.kind) {
    case "fund": {
      // Only fund:create may omit fund data; every other fund action needs the fund.
      if (resource.fund === undefined) {
        return action === "fund:create";
      }
      if (!isWellFormedFund(resource.fund)) {
        return false;
      }
      if (action === "fund:read") {
        return canViewFundByVisibility(roles, resource.fund.policy.visibilityTier);
      }
      return true;
    }

    case "expense": {
      const expense = resource.expense;
      if (!isWellFormedExpense(expense)) {
        return false;
      }
      const policy = expense.policy;

      if (action === "expense:read") {
        return canViewFundByVisibility(roles, policy.visibilityTier);
      }

      if (action === "expense:fraud:acknowledge") {
        return expense.status === "submitted" && hasRole(actor, "owner");
      }

      if (action === "expense:payee:change") {
        return expense.status === "draft" || expense.status === "submitted";
      }

      if (action === "expense:approve") {
        // Only an open (submitted) expense with a recorded approval list can be approved.
        if (expense.status !== "submitted" || !Array.isArray(expense.approvals)) {
          return false;
        }
        const requesterId = normalizeId(expense.requesterId);
        // Rule 1: The requester cannot approve their own request. An actor without an id
        // cannot be shown to differ from the requester, so it is denied.
        // https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
        const actorId = normalizeId(actor.id);
        if (!actorId || actorId === requesterId) {
          return false;
        }
        if (!hasRole(actor, "approver") && !hasRole(actor, "owner")) {
          return false;
        }
        // Duplicate approval prevention
        if (expense.approvals.some((a) => approverKey(a) === actorId)) {
          return false;
        }
        // Rule 2: The treasurer cannot be the sole approver
        // https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
        if (hasRole(actor, "treasurer")) {
          const requiredQuorum = requiredQuorumForExpense(policy, expense.amountPaise);
          // If required quorum is 1, a treasurer's approval would make them the sole approver
          if (requiredQuorum === 1) {
            return false;
          }
          // Existing approvals are filtered first (eligibility, requester exclusion, dedupe),
          // so an ineligible or requester approval cannot supply the independent approver.
          const existing = filterValidApprovals(expense.approvals, requesterId, actorId);
          const hasIndependentNonTreasurer = existing.some((a) => !isTreasurerApproval(a));
          if (!hasIndependentNonTreasurer && existing.length + 1 >= requiredQuorum) {
            return false;
          }
        }
        return true;
      }

      // Evidence tamper resistance (Threat E4 & R6): evidence is locked once the
      // recorded approvals satisfy the policy, and whenever the approval state is unknown.
      if (action === "expense:add_evidence") {
        if (
          expense.status !== "submitted" ||
          !Array.isArray(expense.approvals) ||
          !expense.approvals.every(isWellFormedApproval)
        ) {
          return false;
        }
        return !isExpenseFullyApproved(
          expense.approvals,
          policy,
          expense.amountPaise,
          expense.requesterId,
        );
      }

      // Objections must be within the objection window; an unknown window is closed (R9)
      if (action === "expense:raise_objection") {
        return expense.objectionWindowOpen === true;
      }

      // Payouts require verified approval (R2). Paid, rejected and unknown states never pay out.
      if (action === "expense:payout") {
        if (expense.status !== "submitted" && expense.status !== "approved") {
          return false;
        }
        if (!Array.isArray(expense.approvals)) {
          return false;
        }
        return isExpenseFullyApproved(
          expense.approvals,
          policy,
          expense.amountPaise,
          expense.requesterId,
        );
      }

      return true;
    }

    case "member": {
      const member = resource.member;
      if (
        !member ||
        typeof member !== "object" ||
        !isValidRole(member.targetRole) ||
        normalizeId(member.memberId) === ""
      ) {
        return false;
      }
      if (member.policy !== undefined && !isValidFundPolicy(member.policy)) return false;
      if (action === "fund:add_member" || action === "fund:remove_member") {
        if (!hasRole(actor, "owner")) return false;
        const actorId = normalizeId(actor.id);
        const memberId = normalizeId(member.memberId);
        return Boolean(actorId && memberId && actorId !== memberId);
      }
      if (action === "member:payee_profile:set" || action === "member:payee_profile:clear") {
        return hasRole(actor, "owner") || normalizeId(actor.id) === normalizeId(member.memberId);
      }
      return false;
    }

    case "donation": {
      const donation = resource.donation;
      if (!donation || typeof donation !== "object" || !isValidFundPolicy(donation.policy)) {
        return false;
      }
      if (donation.amountPaise !== undefined && !isValidPaiseAmount(donation.amountPaise)) {
        return false;
      }
      if (action === "donation:read") {
        return canViewFundByVisibility(roles, donation.policy.visibilityTier);
      }
      return true;
    }

    case "audit": {
      const audit = resource.audit;
      if (!audit || typeof audit !== "object" || !isValidFundPolicy(audit.policy)) {
        return false;
      }
      if (action === "audit:read_log") {
        return canViewFundByVisibility(roles, audit.policy.visibilityTier);
      }
      return true;
    }

    case "bank": {
      const bank = resource.bank;
      if (!bank || typeof bank !== "object") {
        return false;
      }
      if (bank.policy !== undefined && !isValidFundPolicy(bank.policy)) {
        return false;
      }
      return true;
    }

    default:
      // Unreachable: the kind check above only passes for the six known kinds.
      return false;
  }
}

function approverKey(approval: ApprovalRecord): string {
  return approval && typeof approval === "object" ? normalizeId(approval.approverId) : "";
}

function isWellFormedApproval(value: unknown): value is ApprovalRecord {
  if (!value || typeof value !== "object") return false;
  const approval = value as Partial<ApprovalRecord>;
  return (
    normalizeId(approval.approverId) !== "" &&
    isValidRole(approval.roleAtApproval) &&
    (approval.rolesAtApproval === undefined ||
      (Array.isArray(approval.rolesAtApproval) && approval.rolesAtApproval.every(isValidRole)))
  );
}

/** Only approvals recorded as owner or approver count toward quorum (R4). */
function isEligibleApproverRole(approval: ApprovalRecord): boolean {
  if (approval.roleAtApproval === "owner" || approval.roleAtApproval === "approver") {
    return true;
  }
  return (
    Array.isArray(approval.rolesAtApproval) &&
    approval.rolesAtApproval.some((r) => r === "owner" || r === "approver")
  );
}

function isTreasurerApproval(approval: ApprovalRecord): boolean {
  if (approval.roleAtApproval === "treasurer") return true;
  return Array.isArray(approval.rolesAtApproval) && approval.rolesAtApproval.includes("treasurer");
}

/**
 * Keeps the approvals that can count toward quorum: a non-empty approver id, not the requester,
 * not the excluded approver, an eligible owner/approver role, and at most one per approver.
 */
function filterValidApprovals(
  approvals: readonly ApprovalRecord[],
  requesterId: string,
  excludeApproverId?: string,
): ApprovalRecord[] {
  const seenApproverIds = new Set<string>();
  const valid: ApprovalRecord[] = [];

  for (const approval of approvals) {
    if (!isWellFormedApproval(approval)) continue;
    const id = normalizeId(approval.approverId);
    if (!id) continue;
    if (id === requesterId) continue;
    if (excludeApproverId !== undefined && id === excludeApproverId) continue;
    if (!isEligibleApproverRole(approval)) continue;
    if (seenApproverIds.has(id)) continue;
    seenApproverIds.add(id);
    valid.push(approval);
  }
  return valid;
}

/**
 * Validates whether a set of approvals satisfies the M-of-N policy and separation of duties:
 * 1. Count of distinct eligible approvals >= required quorum for the expense amount.
 * 2. Requester is NOT counted, and approver ids must be non-empty.
 * 3. Approvers must have been recorded as owner or approver.
 * 4. At least one counted approver is not a treasurer (treasurers cannot be the sole approvers).
 */
export function isExpenseFullyApproved(
  approvals: readonly ApprovalRecord[],
  policy: FundPolicy,
  amountPaise: Paise,
  requesterId: string,
): boolean {
  if (!isValidFundPolicy(policy) || !isValidPaiseAmount(amountPaise)) {
    return false;
  }
  const reqId = normalizeId(requesterId);
  if (!reqId || !Array.isArray(approvals)) {
    return false;
  }

  const requiredQuorum = requiredQuorumForExpense(policy, amountPaise);
  const validApprovals = filterValidApprovals(approvals, reqId);

  if (validApprovals.length < requiredQuorum) {
    return false;
  }

  return validApprovals.some((a) => !isTreasurerApproval(a));
}

/**
 * Evaluates visibility tier access based on viewer's roles.
 */
function canViewFundByVisibility(viewerRoles: readonly FundRole[], tier: VisibilityTier): boolean {
  if (!isValidVisibilityTier(tier)) {
    return false;
  }
  switch (tier) {
    case "public":
      return true;

    case "donors":
      return viewerRoles.some((role) => role === "donor" || role === "member" || isStaffRole(role));

    case "members":
      return viewerRoles.some((role) => role === "member" || isStaffRole(role));

    case "private":
      return viewerRoles.some((role) => isStaffRole(role));

    default:
      return false;
  }
}
