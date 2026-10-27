import type { Paise } from "@yen/shared";
import type { Action } from "./actions.js";
import { isActionAllowedForRole } from "./matrix.js";
import { type FundPolicy, requiredQuorumForExpense, type VisibilityTier } from "./policy.js";
import type { ApprovalRecord, Resource } from "./resources.js";
import { type Actor, type FundRole, hasRole, isStaffRole } from "./roles.js";

/**
 * Checks whether an actor has permission to perform an action on a given resource.
 *
 * Core Guarantees:
 * 1. Deny by default: Any action/role pair not explicitly granted returns false.
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
 *    - Evidence cannot be added or swapped once an expense is approved (Threat E4).
 */
export function can(actor: Actor, action: Action, resource?: Resource): boolean {
  // 1. Base Role Matrix Check (Deny by default)
  const candidateRoles: readonly FundRole[] =
    actor.roles && actor.roles.length > 0 ? actor.roles : [actor.role];

  const hasBasePermission = candidateRoles.some((role) => isActionAllowedForRole(role, action));
  if (!hasBasePermission) {
    return false;
  }

  // If no resource provided, base matrix permission determines access
  if (!resource) {
    return true;
  }

  // 2. Resource-Specific & Contextual Policy Checks
  switch (resource.kind) {
    case "fund": {
      if (action === "fund:read" && resource.fund?.policy) {
        return canViewFundByVisibility(candidateRoles, resource.fund.policy.visibilityTier);
      }
      return true;
    }

    case "expense": {
      const expense = resource.expense;
      const policy = expense.policy;

      // Visibility check for reading expenses
      if (action === "expense:read") {
        return canViewFundByVisibility(candidateRoles, policy.visibilityTier);
      }

      // Separation of Duties: Approving expenses
      if (action === "expense:approve") {
        // Rule 1: The requester cannot approve their own request
        // https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
        if (
          actor.id !== undefined &&
          expense.requesterId !== undefined &&
          actor.id === expense.requesterId
        ) {
          return false;
        }

        // Must hold approver or owner role to approve
        const canApproveRole = hasRole(actor, "approver") || hasRole(actor, "owner");
        if (!canApproveRole) {
          return false;
        }

        // Duplicate approval prevention
        if (
          expense.approvals &&
          actor.id !== undefined &&
          expense.approvals.some((a) => a.approverId === actor.id)
        ) {
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

          // If all existing approvals were from treasurers, this approval would leave only treasurers
          const existingApprovals = expense.approvals ?? [];
          const nonTreasurerApprovals = existingApprovals.filter((a) => !isTreasurerApproval(a));
          if (
            nonTreasurerApprovals.length === 0 &&
            existingApprovals.length + 1 >= requiredQuorum
          ) {
            return false;
          }
        }

        return true;
      }

      // Evidence tamper resistance (Threat E4)
      if (action === "expense:add_evidence") {
        if (expense.status === "approved" || expense.status === "paid") {
          return false;
        }
        return true;
      }

      // Objections must be within the objection window
      if (action === "expense:raise_objection") {
        if (expense.objectionWindowOpen === false) {
          return false;
        }
        return true;
      }

      // Payouts require verified approval
      if (action === "expense:payout") {
        if (expense.status === "approved") {
          return true;
        }
        if (
          expense.approvals &&
          expense.amountPaise !== undefined &&
          expense.requesterId !== undefined
        ) {
          return isExpenseFullyApproved(
            expense.approvals,
            policy,
            expense.amountPaise,
            expense.requesterId,
          );
        }
        return false;
      }

      return true;
    }

    case "donation": {
      if (action === "donation:read") {
        return canViewFundByVisibility(candidateRoles, resource.donation.policy.visibilityTier);
      }
      return true;
    }

    case "member": {
      // Threat X4: Member grants self a role
      // Only owner can add or remove members, and cannot grant roles to themselves if already owner
      if (action === "fund:add_member" || action === "fund:remove_member") {
        const isOwner = hasRole(actor, "owner");
        if (!isOwner) return false;
        if (actor.id !== undefined && actor.id === resource.member.memberId) {
          return false; // Cannot modify own membership to prevent privilege confusion
        }
        return true;
      }
      return true;
    }

    case "audit": {
      if (action === "audit:read_log") {
        return canViewFundByVisibility(candidateRoles, resource.audit.policy.visibilityTier);
      }
      return true;
    }

    case "bank": {
      return true;
    }

    default: {
      const exhaustive: never = resource;
      return exhaustive;
    }
  }
}

/**
 * Validates whether a set of approvals satisfies the M-of-N policy and separation of duties:
 * 1. Count of distinct valid approvals >= required quorum for the expense amount.
 * 2. Requester is NOT in the approval set.
 * 3. The set of approvers is NOT solely treasurers (at least one non-treasurer approver required).
 */
export function isExpenseFullyApproved(
  approvals: readonly ApprovalRecord[],
  policy: FundPolicy,
  amountPaise: Paise,
  requesterId: string,
): boolean {
  const requiredQuorum = requiredQuorumForExpense(policy, amountPaise);

  // Distinct approvers only
  const seenApproverIds = new Set<string>();
  const validApprovals: ApprovalRecord[] = [];

  for (const approval of approvals) {
    const id = String(approval.approverId);
    // Requester cannot approve own request
    if (id === requesterId) {
      continue;
    }
    if (!seenApproverIds.has(id)) {
      seenApproverIds.add(id);
      validApprovals.push(approval);
    }
  }

  if (validApprovals.length < requiredQuorum) {
    return false;
  }

  // Treasurer cannot be the sole approver:
  // If all valid approvers are treasurers, approval is invalid
  const hasNonTreasurerApprover = validApprovals.some((a) => !isTreasurerApproval(a));
  if (!hasNonTreasurerApprover) {
    return false;
  }

  return true;
}

function isTreasurerApproval(approval: ApprovalRecord): boolean {
  if (approval.roleAtApproval === "treasurer") return true;
  if (approval.rolesAtApproval?.includes("treasurer")) return true;
  return false;
}

/**
 * Evaluates visibility tier access based on viewer's roles.
 */
function canViewFundByVisibility(viewerRoles: readonly FundRole[], tier: VisibilityTier): boolean {
  switch (tier) {
    case "public":
      return true;

    case "donors":
      return viewerRoles.some((role) => role === "donor" || isStaffRole(role));

    case "members":
      return viewerRoles.some((role) => isStaffRole(role));

    case "private":
      return viewerRoles.some((role) => isStaffRole(role));

    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}
