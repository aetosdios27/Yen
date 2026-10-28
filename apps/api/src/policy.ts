import type { z } from "@hono/zod-openapi";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
import type {
  addMemberResponse,
  expenseApprovalResponse,
  expenseRejectionResponse,
  fundSchema,
  payeeChangeResponse,
  policyChangeResponse,
  removeMemberResponse,
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

/**
 * Validates and redacts an action receipt using a strict field allowlist.
 * Guarantees that internal fields, raw fund records, or unexpected payload fields
 * cannot leak across the API boundary.
 */
export function redactActionReceipt<A extends ActionReceiptAction>(
  action: A,
  receipt: unknown,
): Redacted<ActionReceiptMap[A]> {
  if (!receipt || typeof receipt !== "object") {
    throw new Error("Invalid receipt: expected object");
  }
  const raw = receipt as Record<string, unknown>;

  switch (action) {
    case "fund:expense:approve": {
      if (
        raw.status !== "approved" ||
        typeof raw.expenseId !== "string" ||
        typeof raw.approvedAt !== "string"
      ) {
        throw new Error("Invalid expense approval receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "approved" as const,
        expenseId: raw.expenseId,
        approvedAt: raw.approvedAt,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    case "fund:expense:reject": {
      if (
        raw.status !== "rejected" ||
        typeof raw.expenseId !== "string" ||
        typeof raw.reason !== "string" ||
        typeof raw.rejectedAt !== "string"
      ) {
        throw new Error("Invalid expense rejection receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "rejected" as const,
        expenseId: raw.expenseId,
        reason: raw.reason,
        rejectedAt: raw.rejectedAt,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    case "fund:payee:change": {
      if (raw.status !== "updated" || typeof raw.vpa !== "string") {
        throw new Error("Invalid payee change receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "updated" as const,
        vpa: raw.vpa,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    case "fund:policy:change": {
      if (
        raw.status !== "updated" ||
        !raw.policyJson ||
        typeof raw.policyJson !== "object" ||
        Array.isArray(raw.policyJson)
      ) {
        throw new Error("Invalid policy change receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "updated" as const,
        policyJson: raw.policyJson as Record<string, unknown>,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    case "fund:member:add": {
      if (
        raw.status !== "added" ||
        typeof raw.memberId !== "string" ||
        typeof raw.role !== "string"
      ) {
        throw new Error("Invalid member add receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "added" as const,
        memberId: raw.memberId,
        role: raw.role,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    case "fund:member:remove": {
      if (raw.status !== "removed" || typeof raw.memberId !== "string") {
        throw new Error("Invalid member remove receipt: shape mismatch");
      }
      return unsafeMarkRedactedForDevPolicy({
        status: "removed" as const,
        memberId: raw.memberId,
      } as unknown) as Redacted<ActionReceiptMap[A]>;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unsupported action receipt: ${String(_exhaustive)}`);
    }
  }
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
    if (action === "fund:member:unlock") return true;
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
