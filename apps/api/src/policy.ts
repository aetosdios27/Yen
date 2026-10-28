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
