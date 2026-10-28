import type { z } from "@hono/zod-openapi";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
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
    if (resource.kind === "fund") {
      return resource.fund === undefined
        ? action === "fund:create"
        : action === "fund:read" && resource.fund.owner === principal.id;
    }
    if (resource.kind === "expense") {
      switch (action) {
        case "expense:create":
        case "expense:read":
          return true;
        case "expense:submit":
          return resource.expense?.owner === principal.id;
        case "expense:approve":
          // Separation of duties: requester cannot approve
          return resource.expense !== undefined && resource.expense.owner !== principal.id;
        case "expense:reject":
        case "expense:pay":
        case "expense:reconcile":
          return true;
        default:
          return false;
      }
    }
    return false;
  },
  redact: (_viewer, resource) => unsafeMarkRedactedForDevPolicy(resource.fund.fund),
  redactExpense: (_viewer, resource) => resource.expense.expense,
};
