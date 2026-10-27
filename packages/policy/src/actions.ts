/**
 * All actions evaluated by the policy engine across funds, expenses, donations,
 * membership, audits, and banking reconciliation.
 */
export const ACTIONS = [
  "fund:create",
  "fund:read",
  "fund:update_policy",
  "fund:update_visibility",
  "fund:close",
  "fund:add_member",
  "fund:remove_member",
  "expense:submit",
  "expense:approve",
  "expense:reject",
  "expense:flag",
  "expense:raise_objection",
  "expense:resolve_objection",
  "expense:payout",
  "expense:add_evidence",
  "expense:read",
  "donation:pledge",
  "donation:verify",
  "donation:reject",
  "donation:read",
  "audit:read_log",
  "bank:reconcile",
] as const;

export type Action = (typeof ACTIONS)[number];

export type ResourceKind = "fund" | "expense" | "donation" | "member" | "audit" | "bank";

/**
 * Mapping declaring the exact resource kind required by each action.
 * Any mismatch between action and resource kind fails closed.
 */
export const ACTION_RESOURCE_MAP = {
  "fund:create": "fund",
  "fund:read": "fund",
  "fund:update_policy": "fund",
  "fund:update_visibility": "fund",
  "fund:close": "fund",
  "fund:add_member": "member",
  "fund:remove_member": "member",
  "expense:submit": "expense",
  "expense:approve": "expense",
  "expense:reject": "expense",
  "expense:flag": "expense",
  "expense:raise_objection": "expense",
  "expense:resolve_objection": "expense",
  "expense:payout": "expense",
  "expense:add_evidence": "expense",
  "expense:read": "expense",
  "donation:pledge": "donation",
  "donation:verify": "donation",
  "donation:reject": "donation",
  "donation:read": "donation",
  "audit:read_log": "audit",
  "bank:reconcile": "bank",
} as const satisfies Record<Action, ResourceKind>;

export function expectedResourceKind(action: Action): ResourceKind {
  return ACTION_RESOURCE_MAP[action];
}

const ACTION_SET = new Set<string>(ACTIONS);

export function isValidAction(action: unknown): action is Action {
  return typeof action === "string" && ACTION_SET.has(action);
}
