import type { z } from "@hono/zod-openapi";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
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
    if (resource.kind === "fund") {
      return resource.fund === undefined
        ? action === "fund:create"
        : action === "fund:read" && resource.fund.owner === principal.id;
    }
    if (resource.kind === "expense") {
      return (
        (action === "expense:add_evidence" || action === "expense:read_evidence") &&
        resource.fund.owner === principal.id
      );
    }
    return false;
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
