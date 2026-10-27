import type { FundId, Paise, PseudonymId, UserId } from "@yen/shared";
import type { FundPolicy } from "./policy.js";
import type { FundRole } from "./roles.js";

export interface ApprovalRecord {
  readonly approverId: PseudonymId | UserId | string;
  readonly roleAtApproval: FundRole;
  readonly rolesAtApproval?: readonly FundRole[];
}

export interface FundResourceData {
  readonly fundId?: FundId;
  readonly ownerId?: PseudonymId | UserId | string;
  readonly policy: FundPolicy;
}

export interface ExpenseResourceData {
  readonly fundId: FundId;
  readonly expenseId?: string;
  readonly policy: FundPolicy;
  readonly requesterId: PseudonymId | UserId | string;
  readonly amountPaise: Paise;
  readonly status?: "submitted" | "approved" | "rejected" | "paid";
  readonly approvals?: readonly ApprovalRecord[];
  readonly objectionWindowOpen?: boolean;
  readonly hasEvidence?: boolean;
}

export interface DonationResourceData {
  readonly fundId: FundId;
  readonly policy: FundPolicy;
  readonly donorId?: PseudonymId | UserId | string;
  readonly amountPaise?: Paise;
}

export interface MemberResourceData {
  readonly fundId: FundId;
  readonly policy?: FundPolicy;
  readonly memberId: PseudonymId | UserId | string;
  readonly targetRole: FundRole;
}

export interface AuditResourceData {
  readonly fundId: FundId;
  readonly policy: FundPolicy;
}

export interface BankResourceData {
  readonly fundId: FundId;
  readonly policy?: FundPolicy;
}

export type Resource =
  | { readonly kind: "fund"; readonly fund?: FundResourceData }
  | { readonly kind: "expense"; readonly expense: ExpenseResourceData }
  | { readonly kind: "donation"; readonly donation: DonationResourceData }
  | { readonly kind: "member"; readonly member: MemberResourceData }
  | { readonly kind: "audit"; readonly audit: AuditResourceData }
  | { readonly kind: "bank"; readonly bank: BankResourceData };
