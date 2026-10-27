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
