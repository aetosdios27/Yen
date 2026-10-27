import type { z } from "@hono/zod-openapi";
import { markRedacted, type Redacted } from "@yen/policy";
import type { fundSchema } from "./contract.js";
import type { Principal } from "./dependencies.js";

export type FundView = z.infer<typeof fundSchema>;
export interface FundRecord {
  readonly owner: string;
  readonly fund: FundView;
}
export type FundAction = "fund:create" | "fund:read";
export type FundResource = { readonly kind: "fund"; readonly fund?: FundRecord };
export type ExistingFundResource = { readonly kind: "fund"; readonly fund: FundRecord };

export interface Policy {
  can(principal: Principal, action: FundAction, resource: FundResource): boolean;
  redact(viewer: Principal, resource: ExistingFundResource): Redacted<FundView>;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact: () => {
    throw new Error("Fund redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) =>
    resource.fund === undefined
      ? action === "fund:create"
      : action === "fund:read" && resource.fund.owner === principal.id,
  redact: (_viewer, resource) => markRedacted(resource.fund.fund),
};
