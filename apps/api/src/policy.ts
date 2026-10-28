import type { z } from "@hono/zod-openapi";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
import {
  type addMemberResponse,
  addMemberResponse as addMemberResponseSchema,
  type expenseApprovalResponse,
  expenseApprovalResponse as expenseApprovalResponseSchema,
  type expenseRejectionResponse,
  expenseRejectionResponse as expenseRejectionResponseSchema,
  type fundSchema,
  type payeeChangeResponse,
  payeeChangeResponse as payeeChangeResponseSchema,
  type policyChangeResponse,
  policyChangeResponse as policyChangeResponseSchema,
  type removeMemberResponse,
  removeMemberResponse as removeMemberResponseSchema,
} from "./contract.js";
import type { Principal } from "./dependencies.js";

export type FundView = z.infer<typeof fundSchema>;
export interface FundRecord {
  readonly owner: string;
  readonly fund: FundView;
}
export type FundAction =
  | "fund:create"
  | "fund:read"
  | "fund:expense:approve"
  | "fund:expense:reject"
  | "fund:payee:change"
  | "fund:policy:change"
  | "fund:member:add"
  | "fund:member:remove"
  | "fund:member:unlock";
export type FundResource = { readonly kind: "fund"; readonly fund?: FundRecord };
export type ExistingFundResource = { readonly kind: "fund"; readonly fund: FundRecord };

export type ExpenseApprovalReceipt = z.infer<typeof expenseApprovalResponse>;
export type ExpenseRejectionReceipt = z.infer<typeof expenseRejectionResponse>;
export type PayeeChangeReceipt = z.infer<typeof payeeChangeResponse>;
export type PolicyChangeReceipt = z.infer<typeof policyChangeResponse>;
export type AddMemberReceipt = z.infer<typeof addMemberResponse>;
export type RemoveMemberReceipt = z.infer<typeof removeMemberResponse>;

export type ActionReceiptAction =
  | "fund:expense:approve"
  | "fund:expense:reject"
  | "fund:payee:change"
  | "fund:policy:change"
  | "fund:member:add"
  | "fund:member:remove";

export type ActionReceiptMap = {
  "fund:expense:approve": ExpenseApprovalReceipt;
  "fund:expense:reject": ExpenseRejectionReceipt;
  "fund:payee:change": PayeeChangeReceipt;
  "fund:policy:change": PolicyChangeReceipt;
  "fund:member:add": AddMemberReceipt;
  "fund:member:remove": RemoveMemberReceipt;
};

const ACTION_RECEIPT_SCHEMAS = {
  "fund:expense:approve": expenseApprovalResponseSchema,
  "fund:expense:reject": expenseRejectionResponseSchema,
  "fund:payee:change": payeeChangeResponseSchema,
  "fund:policy:change": policyChangeResponseSchema,
  "fund:member:add": addMemberResponseSchema,
  "fund:member:remove": removeMemberResponseSchema,
} as const;

const ACTION_RECEIPT_ALLOWLIST = {
  "fund:expense:approve": ["status", "expenseId", "approvedAt"],
  "fund:expense:reject": ["status", "expenseId", "reason", "rejectedAt"],
  "fund:payee:change": ["status", "vpa"],
  "fund:policy:change": ["status", "policyJson"],
  "fund:member:add": ["status", "memberId", "role"],
  "fund:member:remove": ["status", "memberId"],
} as const;

/**
 * Validates and redacts an action receipt using authoritative response Zod schemas
 * and strict field allowlists. Guarantees that internal fields, raw fund records,
 * or unexpected payload fields cannot leak across the API boundary.
 *
 * NOTE: Action receipts (e.g. fund:expense:approve, fund:payee:change) acknowledge
 * successful cryptographic verification and authorization. They are distinct from
 * persistent banking operations or transaction execution, which belong to the separate
 * ledger/bank reconciliation scope.
 */
export function redactActionReceipt<A extends ActionReceiptAction>(
  action: A,
  receipt: unknown,
): Redacted<ActionReceiptMap[A]> {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Invalid receipt: expected object");
  }

  const schema = ACTION_RECEIPT_SCHEMAS[action];
  const allowlist = ACTION_RECEIPT_ALLOWLIST[action];
  if (!schema || !allowlist) {
    throw new Error(`Unsupported action receipt: ${String(action)}`);
  }

  const raw = receipt as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (key in raw) {
      filtered[key] = raw[key];
    }
  }

  const actionNames: Record<ActionReceiptAction, string> = {
    "fund:expense:approve": "expense approval",
    "fund:expense:reject": "expense rejection",
    "fund:payee:change": "payee change",
    "fund:policy:change": "policy change",
    "fund:member:add": "member add",
    "fund:member:remove": "member remove",
  };

  const parseResult = schema.safeParse(filtered);
  if (!parseResult.success) {
    throw new Error(`Invalid ${actionNames[action]} receipt: shape mismatch`);
  }

  return unsafeMarkRedactedForDevPolicy(parseResult.data as ActionReceiptMap[A]);
}

export interface Policy {
  can(principal: Principal, action: FundAction, resource: FundResource): boolean;
  redact(viewer: Principal, resource: ExistingFundResource): Redacted<FundView>;
  redactReceipt<A extends ActionReceiptAction>(
    viewer: Principal,
    action: A,
    receipt: unknown,
    resource?: ExistingFundResource,
  ): Redacted<ActionReceiptMap[A]>;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact: () => {
    throw new Error("Fund redaction is unavailable");
  },
  redactReceipt: () => {
    throw new Error("Receipt redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) => {
    if (action === "fund:member:unlock") {
      const roles = principal.roles ?? [];
      const capabilities = principal.capabilities ?? [];
      return (
        roles.includes("admin") ||
        roles.includes("recovery") ||
        capabilities.includes("admin") ||
        capabilities.includes("recovery")
      );
    }
    if (resource.fund === undefined) return action === "fund:create";
    return resource.fund.owner === principal.id;
  },
  redact: (_viewer, resource) => unsafeMarkRedactedForDevPolicy(resource.fund.fund),
  redactReceipt: (viewer, action, receipt, resource) => {
    if (!devPolicy.can(viewer, action, resource ?? { kind: "fund" })) {
      throw new Error("Forbidden: principal cannot perform action");
    }
    return redactActionReceipt(action, receipt);
  },
};
