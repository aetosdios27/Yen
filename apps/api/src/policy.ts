import type { z } from "@hono/zod-openapi";
import type { fundSchema } from "./contract.js";
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

export interface Policy {
  can(principal: Principal, action: FundAction, resource: FundResource): boolean;
  redact(viewer: Principal, resource: ExistingFundResource): FundView;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact: () => {
    throw new Error("Fund redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) => {
    if (action === "fund:member:unlock") return true;
    if (resource.fund === undefined) return action === "fund:create";
    return resource.fund.owner === principal.id;
  },
  redact: (_viewer, resource) => resource.fund.fund,
};
