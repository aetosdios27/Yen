import type { z } from "@hono/zod-openapi";
import type { donationDetailsSchema, fundSchema } from "./contract.js";
import type { Principal } from "./dependencies.js";

export type FundView = z.infer<typeof fundSchema>;
export interface FundRecord {
  readonly owner: string;
  readonly fund: FundView;
}
export type FundAction = "fund:create" | "fund:read";
export type FundResource = { readonly kind: "fund"; readonly fund?: FundRecord };
export type ExistingFundResource = { readonly kind: "fund"; readonly fund: FundRecord };
export type DonationDetailsView = z.infer<typeof donationDetailsSchema>;

export interface Policy {
  can(principal: Principal, action: FundAction, resource: FundResource): boolean;
  redact(viewer: Principal, resource: ExistingFundResource): FundView;
  /** Donors are anonymous, so paying in is decided from the fund alone. */
  canDonate(resource: ExistingFundResource): boolean;
  /** The single public view of a fund's payment details. */
  redactDonationDetails(resource: ExistingFundResource): DonationDetailsView;
}

export const denyAllPolicy: Policy = {
  can: () => false,
  redact: () => {
    throw new Error("Fund redaction is unavailable");
  },
  canDonate: () => false,
  redactDonationDetails: () => {
    throw new Error("Donation details redaction is unavailable");
  },
};

export const devPolicy: Policy = {
  can: (principal, action, resource) =>
    resource.fund === undefined
      ? action === "fund:create"
      : action === "fund:read" && resource.fund.owner === principal.id,
  redact: (_viewer, resource) => resource.fund.fund,
  canDonate: (resource) => resource.fund.fund.id.length > 0,
  redactDonationDetails: (resource) => ({
    fundId: resource.fund.fund.id,
    title: resource.fund.fund.name,
    upiVpa: resource.fund.fund.upiVpa,
    upiPayeeName: resource.fund.fund.upiPayeeName,
  }),
};
