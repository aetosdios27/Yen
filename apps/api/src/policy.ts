import type { z } from "@hono/zod-openapi";
import {
  DEFAULT_FUND_POLICY,
  can as policyCan,
  type Redacted,
  unsafeMarkRedactedForDevPolicy,
} from "@yen/policy";
import { paise, parseFundId } from "@yen/shared";
import type { fundSchema } from "./contract.js";
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
  | "expense:add_evidence"
  | "expense:read_evidence";
export type FundResource =
  | { readonly kind: "fund"; readonly fund?: FundRecord }
  | { readonly kind: "expense"; readonly fund: FundRecord; readonly expenseId: string };
export type ExistingFundResource =
  | { readonly kind: "fund"; readonly fund: FundRecord }
  | { readonly kind: "evidence"; readonly evidence: StoredEvidence }
  | { readonly kind: "evidence_list"; readonly evidence: readonly StoredEvidence[] };

export interface Policy {
  can(principal: Principal, action: FundAction, resource: FundResource): boolean;
  redact(
    viewer: Principal,
    resource: { readonly kind: "fund"; readonly fund: FundRecord },
  ): Redacted<FundView>;
  redact(
    viewer: Principal,
    resource: { readonly kind: "evidence"; readonly evidence: StoredEvidence },
  ): Redacted<StoredEvidence>;
  redact(
    viewer: Principal,
    resource: { readonly kind: "evidence_list"; readonly evidence: readonly StoredEvidence[] },
  ): Redacted<{ evidence: StoredEvidence[] }>;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact(): never {
    throw new Error("Fund redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) => {
    try {
      const actor = { id: principal.id, role: "owner" as const };
      if (resource.kind === "fund" && resource.fund === undefined) {
        return action === "fund:create" && policyCan(actor, action, { kind: "fund" });
      }
      const fund = resource.fund;
      if (!fund) return false;
      if (fund.owner !== principal.id) return false;
      const fundId = parseFundId(fund.fund.id);
      if (!fundId.ok) return false;
      if (resource.kind === "fund") {
        return (
          action === "fund:read" &&
          policyCan(actor, action, {
            kind: "fund",
            fund: { fundId: fundId.value, ownerId: fund.owner, policy: DEFAULT_FUND_POLICY },
          })
        );
      }
      const engineAction = action === "expense:read_evidence" ? "expense:read" : action;
      return policyCan(actor, engineAction, {
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
    } catch {
      return false;
    }
  },
  redact(
    _viewer: Principal,
    resource: ExistingFundResource,
  ): Redacted<FundView> & Redacted<StoredEvidence> & Redacted<{ evidence: StoredEvidence[] }> {
    if (resource.kind === "fund") {
      return unsafeMarkRedactedForDevPolicy(resource.fund.fund) as unknown as Redacted<FundView> &
        Redacted<StoredEvidence> &
        Redacted<{ evidence: StoredEvidence[] }>;
    }
    if (resource.kind === "evidence") {
      const { objectKey: _discard, ...publicEvidence } = resource.evidence;
      return unsafeMarkRedactedForDevPolicy(
        publicEvidence as StoredEvidence,
      ) as unknown as Redacted<FundView> &
        Redacted<StoredEvidence> &
        Redacted<{ evidence: StoredEvidence[] }>;
    }
    return unsafeMarkRedactedForDevPolicy({
      evidence: resource.evidence.map(({ objectKey: _discard, ...e }) => e as StoredEvidence),
    }) as unknown as Redacted<FundView> &
      Redacted<StoredEvidence> &
      Redacted<{ evidence: StoredEvidence[] }>;
  },
};
