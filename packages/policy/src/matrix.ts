import { type Action, isValidAction } from "./actions.js";
import { type FundRole, isValidRole } from "./roles.js";

/**
 * Compile-time exhaustiveness: every Action MUST have an entry for every FundRole.
 * If any Action or FundRole is added without updating this matrix, TypeScript will
 * fail to compile.
 */
export type RoleActionMatrix = {
  readonly [A in Action]: {
    readonly [R in FundRole]: boolean;
  };
};

export const ROLE_ACTION_MATRIX: RoleActionMatrix = {
  "fund:create": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "fund:read": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: true,
    public: true,
  },
  "fund:update_policy": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "fund:update_visibility": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "fund:close": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "fund:add_member": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "fund:remove_member": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "member:payee_profile:set": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: true,
    public: false,
  },
  "member:payee_profile:clear": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: true,
    public: false,
  },
  "expense:submit": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:payee:change": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:approve": {
    owner: true,
    treasurer: false,
    approver: true,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:reject": {
    owner: true,
    treasurer: false,
    approver: true,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:flag": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: false,
    public: false,
  },
  "expense:fraud:acknowledge": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:raise_objection": {
    owner: false,
    treasurer: false,
    approver: false,
    auditor: true,
    donor: true,
    member: true,
    public: false,
  },
  "expense:resolve_objection": {
    owner: true,
    treasurer: false,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:payout": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:add_evidence": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "expense:read": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: true,
    public: true,
  },
  "donation:pledge": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: false,
    public: true,
  },
  "donation:verify": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "donation:reject": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
  "donation:read": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: true,
    public: true,
  },
  "audit:read_log": {
    owner: true,
    treasurer: true,
    approver: true,
    auditor: true,
    donor: true,
    member: true,
    public: true,
  },
  "bank:reconcile": {
    owner: true,
    treasurer: true,
    approver: false,
    auditor: false,
    donor: false,
    member: false,
    public: false,
  },
} as const;

export function isActionAllowedForRole(role: FundRole, action: Action): boolean {
  if (!isValidRole(role) || !isValidAction(action)) {
    return false;
  }
  if (!Object.hasOwn(ROLE_ACTION_MATRIX, action)) {
    return false;
  }
  const actionRow = ROLE_ACTION_MATRIX[action];
  if (!Object.hasOwn(actionRow, role)) {
    return false;
  }
  return actionRow[role] === true;
}
