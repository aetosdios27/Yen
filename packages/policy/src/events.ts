import type { PseudonymId } from "@yen/shared";
import type { FundPolicy } from "./policy.js";

/**
 * Event payload shapes matching the existing provisional schemas in packages/eventlog:
 * - fund.policy_changed: { approval_quorum: number; objection_window_hours: number }
 * - fund.visibility_changed: { visibility: "private" | "members" | "public" }
 * - member.added: { member_id: PseudonymId; role: "member" | "approver" | "treasurer" }
 * - member.removed: { member_id: PseudonymId }
 *
 * NOTE: Per project guidelines, eventlog schemas are strictly immutable once v1.
 * Gaps between policy requirements and current eventlog v1 payloads are documented below.
 */

export interface FundPolicyChangedPayload {
  readonly approval_quorum: number;
  readonly objection_window_hours: number;
}

export type EventVisibility = "private" | "members" | "public";

export interface FundVisibilityChangedPayload {
  readonly visibility: EventVisibility;
}

export type EventMemberRole = "member" | "approver" | "treasurer";

export interface MemberAddedPayload {
  readonly member_id: PseudonymId;
  readonly role: EventMemberRole;
}

export interface MemberRemovedPayload {
  readonly member_id: PseudonymId;
}

export type PolicyEvent =
  | { readonly type: "fund.policy_changed"; readonly payload: FundPolicyChangedPayload }
  | { readonly type: "fund.visibility_changed"; readonly payload: FundVisibilityChangedPayload }
  | { readonly type: "member.added"; readonly payload: MemberAddedPayload }
  | { readonly type: "member.removed"; readonly payload: MemberRemovedPayload };

/**
 * Audit and Gap Report:
 * Identifies what policy features are supported in packages/eventlog v1 schemas
 * and what is missing for a future v2 event specification.
 */
export const EVENTLOG_SCHEMA_GAP_REPORT = {
  "fund.policy_changed": {
    supportedFields: ["approval_quorum", "objection_window_hours"],
    missingCapabilities: [
      "spend_thresholds: No schema support for recording tiered quorum thresholds (e.g. expenses >= X paise require quorum Y).",
    ],
  },
  "fund.visibility_changed": {
    supportedValues: ["private", "members", "public"],
    missingCapabilities: [
      "donors visibility tier: The database supports 'public' | 'donors' | 'members' | 'private', but eventlog v1 visibility is restricted to 'private' | 'members' | 'public'.",
    ],
  },
  "member.added": {
    supportedRoles: ["member", "approver", "treasurer"],
    missingCapabilities: [
      "owner and auditor roles: The policy engine and db recognize 'owner' and 'auditor', but member.added v1 restricts role to 'member' | 'approver' | 'treasurer'.",
    ],
  },
} as const;

/**
 * Projects a FundPolicy forward given an incoming policy event from packages/eventlog.
 */
export function applyPolicyEvent(current: FundPolicy, event: PolicyEvent): FundPolicy {
  switch (event.type) {
    case "fund.policy_changed": {
      return {
        ...current,
        approvalQuorum: event.payload.approval_quorum,
        objectionWindowHours: event.payload.objection_window_hours,
      };
    }

    case "fund.visibility_changed": {
      return {
        ...current,
        visibilityTier: event.payload.visibility,
      };
    }

    case "member.added":
    case "member.removed": {
      // Membership events affect membership state rather than fund policy parameters
      return current;
    }

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
