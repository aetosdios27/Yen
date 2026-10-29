import type { z } from "@hono/zod-openapi";
import {
  DEFAULT_FUND_POLICY,
  type Action as DomainAction,
  can as policyCan,
  type Redacted,
  unsafeMarkRedactedForDevPolicy,
} from "@yen/policy";
import type { FundId, Paise } from "@yen/shared";
import type { expenseSchema, fundSchema } from "./contract.js";
import type { Principal } from "./dependencies.js";

export type FundView = z.infer<typeof fundSchema>;
export interface FundRecord {
  readonly owner: string;
  readonly fund: FundView;
}
export type FundAction = "fund:create" | "fund:read";
export type FundResource = { readonly kind: "fund"; readonly fund?: FundRecord | undefined };
export type ExistingFundResource = { readonly kind: "fund"; readonly fund: FundRecord };
export type DonationDetailsView = z.infer<typeof donationDetailsSchema>;

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

export type ExpenseView = z.infer<typeof expenseSchema>;
export interface ExpenseRecord {
  readonly owner: string;
  readonly expense: ExpenseView;
}
export type ExpenseAction =
  | "expense:create"
  | "expense:read"
  | "expense:submit"
  | "expense:approve"
  | "expense:reject"
  | "expense:pay"
  | "expense:reconcile";
export type ExpenseResource = {
  readonly kind: "expense";
  readonly expense?: ExpenseRecord | undefined;
};
export type ExistingExpenseResource = {
  readonly kind: "expense";
  readonly expense: ExpenseRecord;
};

export type PolicyAction = FundAction | ExpenseAction;
export type PolicyResource = FundResource | ExpenseResource;

export interface Policy {
  can(principal: Principal, action: PolicyAction, resource: PolicyResource): boolean;
  redact(viewer: Principal, resource: ExistingFundResource): Redacted<FundView>;
  redactExpense?(viewer: Principal, resource: ExistingExpenseResource): ExpenseView;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact: () => {
    throw new Error("Fund redaction is unavailable");
  },
  redactExpense: () => {
    throw new Error("Expense redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) => {
    if (!principal.role) return false;
    const actor = { id: principal.id, role: principal.role };
    if (resource.kind === "fund") {
      if (action === "fund:create") return policyCan(actor, action, { kind: "fund" });
      if (action !== "fund:read" || resource.fund === undefined) return false;
      return policyCan(actor, action, {
        kind: "fund",
        fund: {
          fundId: resource.fund.fund.id as FundId,
          ownerId: resource.fund.owner,
          policy: DEFAULT_FUND_POLICY,
        },
      });
    }
    if (resource.kind === "expense") {
      let domainAction: DomainAction;
      switch (action) {
        case "expense:create":
        case "expense:submit":
          domainAction = "expense:submit";
          break;
        case "expense:read":
          domainAction = "expense:read";
          break;
        case "expense:approve":
          domainAction = "expense:approve";
          break;
        case "expense:reject":
          domainAction = "expense:reject";
          break;
        case "expense:pay":
          domainAction = "expense:payout";
          break;
        case "expense:reconcile":
          domainAction = "bank:reconcile";
          break;
        default:
          return false;
      }

      const record = resource.expense;
      const view = record?.expense;
      const fundId = (view?.fundId ?? "00000000-0000-4000-8000-000000000000") as FundId;
      if (domainAction === "bank:reconcile") {
        return policyCan(actor, domainAction, {
          kind: "bank",
          bank: { fundId, policy: DEFAULT_FUND_POLICY },
        });
      }

      const amountPaise = Number(view?.amountPaise ?? 0) as Paise;
      const approvalCount = view?.approvalsCount ?? 0;
      const supportedStatus = ["submitted", "approved", "rejected", "paid"].includes(
        view?.status ?? "",
      )
        ? (view?.status as "submitted" | "approved" | "rejected" | "paid")
        : undefined;
      return policyCan(actor, domainAction, {
        kind: "expense",
        expense: {
          fundId,
          ...(view?.id === undefined ? {} : { expenseId: view.id }),
          policy: DEFAULT_FUND_POLICY,
          requesterId: record?.owner ?? principal.id,
          amountPaise,
          ...(supportedStatus === undefined ? {} : { status: supportedStatus }),
          approvals: Array.from({ length: approvalCount }, (_, index) => ({
            approverId: `dev-policy-approval-${index}`,
            roleAtApproval: "approver" as const,
          })),
        },
      });
    }
    return false;
  },
  redact: (_viewer, resource) => unsafeMarkRedactedForDevPolicy(resource.fund.fund),
  redactExpense: (_viewer, resource) => resource.expense.expense,
};
