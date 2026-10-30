import type { z } from "@hono/zod-openapi";
import type { PseudonymId } from "@yen/eventlog";
import type { FundRole } from "@yen/policy";
import {
  DEFAULT_FUND_POLICY,
  type Action as DomainAction,
  isStaffRole,
  isValidRole,
  can as policyCan,
  type Redacted,
  unsafeMarkRedactedForDevPolicy,
} from "@yen/policy";
import { type FundId, type Paise, paise, parseFundId } from "@yen/shared";
import {
  type addMemberResponse,
  addMemberResponse as addMemberResponseSchema,
  type donationDetailsSchema,
  type expenseApprovalResponse,
  expenseApprovalResponse as expenseApprovalResponseSchema,
  type expenseRejectionResponse,
  expenseRejectionResponse as expenseRejectionResponseSchema,
  type expenseSchema,
  fundAlertSchema,
  type fundSchema,
  type payeeChangeResponse,
  payeeChangeResponse as payeeChangeResponseSchema,
  type policyChangeResponse,
  policyChangeResponse as policyChangeResponseSchema,
  type removeMemberResponse,
  removeMemberResponse as removeMemberResponseSchema,
} from "./contract.js";
import type { Principal } from "./dependencies.js";
import type { StoredEvidence } from "./stores.js";

export type FundView = z.infer<typeof fundSchema>;
export interface FundRecord {
  readonly owner: string;
  readonly fund: FundView;
}
export type FundAction =
  | "fund:create"
  | "fund:read"
  | "fund:alert:read"
  | "fund:alert:manage"
  | "fund:expense:approve"
  | "fund:expense:reject"
  | "fund:payee:change"
  | "fund:policy:change"
  | "fund:member:add"
  | "fund:member:remove"
  | "fund:member:unlock"
  | "member:payee_profile:set"
  | "member:payee_profile:clear"
  | "fund:reconcile";
export type FundResource = { readonly kind: "fund"; readonly fund?: FundRecord | undefined };
export type ExistingFundResource = { readonly kind: "fund"; readonly fund: FundRecord };
export type MemberResource = {
  readonly kind: "member";
  readonly fund: FundRecord;
  readonly memberId: string;
  readonly actorPseudonym: PseudonymId;
  readonly targetRole: FundRole;
};
export type EvidenceResource =
  | { readonly kind: "evidence"; readonly evidence: StoredEvidence }
  | { readonly kind: "evidence_list"; readonly evidence: readonly StoredEvidence[] };
type RedactedResource<R extends ExistingFundResource | EvidenceResource> =
  R extends ExistingFundResource
    ? Redacted<FundView>
    : R extends { readonly kind: "evidence" }
      ? Redacted<StoredEvidence>
      : Redacted<{ evidence: StoredEvidence[] }>;
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

/** Alert projections share the receipt allowlist machinery but are not policy-engine actions. */
export type AlertReceiptAction =
  | "fund:alert:list"
  | "fund:alert:acknowledge"
  | "fund:alert:resolve";

export type FundAlertView = z.infer<typeof fundAlertSchema>;

export type ActionReceiptMap = {
  "fund:expense:approve": ExpenseApprovalReceipt;
  "fund:expense:reject": ExpenseRejectionReceipt;
  "fund:payee:change": PayeeChangeReceipt;
  "fund:policy:change": PolicyChangeReceipt;
  "fund:member:add": AddMemberReceipt;
  "fund:member:remove": RemoveMemberReceipt;
  "fund:alert:list": FundAlertView;
  "fund:alert:acknowledge": FundAlertView;
  "fund:alert:resolve": FundAlertView;
};

const ACTION_RECEIPT_SCHEMAS = {
  "fund:expense:approve": expenseApprovalResponseSchema,
  "fund:expense:reject": expenseRejectionResponseSchema,
  "fund:payee:change": payeeChangeResponseSchema,
  "fund:policy:change": policyChangeResponseSchema,
  "fund:member:add": addMemberResponseSchema,
  "fund:member:remove": removeMemberResponseSchema,
  "fund:alert:list": fundAlertSchema,
  "fund:alert:acknowledge": fundAlertSchema,
  "fund:alert:resolve": fundAlertSchema,
} as const;

const FUND_ALERT_FIELDS = [
  "id",
  "alertType",
  "severity",
  "status",
  "title",
  "details",
  "createdAt",
  "acknowledgedAt",
  "resolvedAt",
  "escalatedAt",
] as const;

const ACTION_RECEIPT_ALLOWLIST = {
  "fund:expense:approve": ["status", "expenseId", "approvedAt", "approvalsCount"],
  "fund:expense:reject": ["status", "expenseId", "reason", "rejectedAt"],
  "fund:payee:change": ["status", "vpa"],
  "fund:policy:change": ["status", "policyJson"],
  "fund:member:add": ["status", "memberId", "role"],
  "fund:member:remove": ["status", "memberId"],
  "fund:alert:list": FUND_ALERT_FIELDS,
  "fund:alert:acknowledge": FUND_ALERT_FIELDS,
  "fund:alert:resolve": FUND_ALERT_FIELDS,
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
export function redactActionReceipt<A extends ActionReceiptAction | AlertReceiptAction>(
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

  const actionNames: Record<ActionReceiptAction | AlertReceiptAction, string> = {
    "fund:expense:approve": "expense approval",
    "fund:expense:reject": "expense rejection",
    "fund:payee:change": "payee change",
    "fund:policy:change": "policy change",
    "fund:member:add": "member add",
    "fund:member:remove": "member remove",
    "fund:alert:list": "alert",
    "fund:alert:acknowledge": "alert acknowledgement",
    "fund:alert:resolve": "alert resolution",
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
  | "expense:payee:change"
  | "expense:approve"
  | "expense:reject"
  | "expense:pay"
  | "expense:reconcile"
  | "expense:add_evidence"
  | "expense:read_evidence"
  | "expense:fraud:acknowledge"
  | "expense:raise_objection"
  | "expense:resolve_objection";
export type ExpenseResource =
  | { readonly kind: "expense"; readonly expense?: ExpenseRecord | undefined }
  | { readonly kind: "expense"; readonly fund: FundRecord; readonly expenseId: string };
export type ExistingExpenseResource = {
  readonly kind: "expense";
  readonly expense: ExpenseRecord;
};

export type PolicyAction = FundAction | ExpenseAction;
export type PolicyResource = FundResource | ExpenseResource | MemberResource;

export interface Policy {
  can(principal: Principal, action: PolicyAction, resource: PolicyResource): boolean;
  redact<R extends ExistingFundResource | EvidenceResource>(
    viewer: Principal,
    resource: R,
  ): RedactedResource<R>;
  redactExpense?(viewer: Principal, resource: ExistingExpenseResource): ExpenseView;
  canDonate(resource: ExistingFundResource): boolean;
  redactDonationDetails(resource: ExistingFundResource): DonationDetailsView;
  redactUnmatchedCredits<T>(viewer: Principal, resource: ExistingFundResource, credits: T): T;
  redactManualMatch<T>(viewer: Principal, resource: ExistingFundResource, result: T): T;
  redactStatementResult<T>(viewer: Principal, resource: ExistingFundResource, result: T): T;
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
  redactExpense: () => {
    throw new Error("Expense redaction is unavailable");
  },
  canDonate: () => false,
  redactDonationDetails: () => {
    throw new Error("Donation details redaction is unavailable");
  },
  redactUnmatchedCredits: () => {
    throw new Error("Unmatched credits redaction is unavailable");
  },
  redactManualMatch: () => {
    throw new Error("Manual match redaction is unavailable");
  },
  redactStatementResult: () => {
    throw new Error("Statement redaction is unavailable");
  },
  redactReceipt: () => {
    throw new Error("Receipt redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) => {
    if (action === "expense:add_evidence" || action === "expense:read_evidence") {
      if (resource.kind !== "expense" || !("fund" in resource)) return false;
      if (resource.fund.owner !== principal.id) return false;
      const fundId = parseFundId(resource.fund.fund.id);
      if (!fundId.ok) return false;
      const evidenceActor = { id: principal.id, role: "owner" as const };
      const engineAction = action === "expense:read_evidence" ? "expense:read" : action;
      return policyCan(evidenceActor, engineAction, {
        kind: "expense",
        expense: {
          fundId: fundId.value,
          expenseId: resource.expenseId,
          policy: DEFAULT_FUND_POLICY,
          requesterId: principal.id,
          amountPaise: paise(0),
          status: "submitted",
          approvals: [],
        },
      });
    }
    if (action === "fund:member:unlock") {
      const roles = principal.roles ?? [];
      const capabilities = principal.capabilities ?? [];
      return ["admin", "recovery"].some(
        (role) => roles.includes(role) || capabilities.includes(role),
      );
    }
    if (resource.kind === "fund" && action === "fund:create") return true;
    if (
      resource.kind === "fund" &&
      (action === "fund:alert:read" || action === "fund:alert:manage")
    ) {
      const roles = (principal.roles ?? []).filter(isValidRole);
      const role = principal.role ?? roles[0];
      if (!role || !resource.fund) return false;
      const fundId = parseFundId(resource.fund.fund.id);
      if (!fundId.ok) return false;
      return policyCan({ id: principal.id, role, roles }, action, {
        kind: "fund",
        fund: { fundId: fundId.value, ownerId: resource.fund.owner, policy: DEFAULT_FUND_POLICY },
      });
    }
    if (resource.kind === "fund" && action !== "fund:read") {
      return resource.fund?.owner === principal.id;
    }
    const roles = (principal.roles ?? []).filter(isValidRole);
    const role = principal.role ?? roles[0];
    if (!role) return false;
    const actor = {
      id: resource.kind === "member" ? resource.actorPseudonym : principal.id,
      role,
      roles,
    };
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
    if (resource.kind === "member") {
      if (action !== "member:payee_profile:set" && action !== "member:payee_profile:clear") {
        return false;
      }
      const fundId = parseFundId(resource.fund.fund.id);
      if (!fundId.ok) return false;
      return policyCan(actor, action, {
        kind: "member",
        member: {
          fundId: fundId.value,
          policy: DEFAULT_FUND_POLICY,
          memberId: resource.memberId,
          targetRole: resource.targetRole,
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
        case "expense:payee:change":
          domainAction = "expense:payee:change";
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
        case "expense:fraud:acknowledge":
          domainAction = "expense:fraud:acknowledge";
          break;
        case "expense:raise_objection":
        case "expense:resolve_objection":
          domainAction = action;
          break;
        default:
          return false;
      }

      const record = "expense" in resource ? resource.expense : undefined;
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
      const supportedStatus = ["draft", "submitted", "approved", "rejected", "paid"].includes(
        view?.status ?? "",
      )
        ? (view?.status as "draft" | "submitted" | "approved" | "rejected" | "paid")
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
          ...(view?.objectionWindowOpen === undefined
            ? {}
            : { objectionWindowOpen: view.objectionWindowOpen }),
          approvals: Array.from({ length: approvalCount }, (_, index) => ({
            approverId: `dev-policy-approval-${index}`,
            roleAtApproval: "approver" as const,
          })),
        },
      });
    }
    return false;
  },
  redact: <R extends ExistingFundResource | EvidenceResource>(
    _viewer: Principal,
    resource: R,
  ): RedactedResource<R> => {
    if (resource.kind === "fund") {
      return unsafeMarkRedactedForDevPolicy(resource.fund.fund) as RedactedResource<R>;
    }
    if (resource.kind === "evidence") {
      const { objectKey: _discard, ...publicEvidence } = resource.evidence;
      return unsafeMarkRedactedForDevPolicy(publicEvidence) as RedactedResource<R>;
    }
    return unsafeMarkRedactedForDevPolicy({
      evidence: resource.evidence.map(({ objectKey: _discard, ...evidence }) => evidence),
    }) as RedactedResource<R>;
  },
  redactExpense: (viewer, resource) => {
    const expense = resource.expense.expense;
    const roles = [viewer.role, ...(viewer.roles ?? [])].filter(isValidRole);
    if (!roles.some((role) => role === "member" || isStaffRole(role))) {
      const {
        fraudFlags: _flags,
        fraudAcknowledgements: _acks,
        payee: _payee,
        ...publicExpense
      } = expense;
      return publicExpense as ExpenseView;
    }
    return expense;
  },
  canDonate: (resource) => {
    const fundId = parseFundId(resource.fund.fund.id);
    if (!fundId.ok) return false;
    return policyCan({ role: "public" }, "donation:pledge", {
      kind: "donation",
      donation: { fundId: fundId.value, policy: { ...DEFAULT_FUND_POLICY, fundId: fundId.value } },
    });
  },
  redactDonationDetails: (resource) => ({
    fundId: resource.fund.fund.id,
    title: resource.fund.fund.name,
    upiVpa: resource.fund.fund.upiVpa,
    upiPayeeName: resource.fund.fund.upiPayeeName,
  }),
  redactUnmatchedCredits: (_viewer, _resource, credits) => credits,
  redactManualMatch: (_viewer, _resource, result) => result,
  redactStatementResult: (_viewer, _resource, result) => result,
  redactReceipt: (viewer, action, receipt, resource) => {
    if (!devPolicy.can(viewer, action, resource ?? { kind: "fund" })) {
      throw new Error("Forbidden: principal cannot perform action");
    }
    return redactActionReceipt(action, receipt);
  },
};
