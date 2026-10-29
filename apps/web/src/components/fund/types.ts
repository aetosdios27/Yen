import type { Paise } from "@yen/shared";

export type SpendingCategoryId =
  | "equipment"
  | "travel"
  | "registration"
  | "logistics"
  | "food"
  | "other";

export type SpendingCategory = {
  readonly id: SpendingCategoryId;
  readonly amount: Paise;
  readonly percentage: number;
};

export type PublicEvidence = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly mimeType?: string | undefined;
};

export type PublicVerification = {
  readonly status: "verified" | "pending";
  readonly recordProofUrl?: string | undefined;
  readonly intervalRootHex?: string | undefined;
  readonly confirmedAt?: string | undefined;
  readonly approverCount?: number | undefined;
};

export type PublicTimelineEntry = {
  readonly id: string;
  readonly type: "donation" | "expense";
  readonly title: string;
  readonly description?: string | undefined;
  readonly amount: Paise;
  readonly dateTime: string;
  readonly category?: SpendingCategoryId | undefined;
  readonly status: "verified" | "pending";
  readonly donorName?: string | undefined;
  readonly evidence?: PublicEvidence | undefined;
  readonly verification?: PublicVerification | undefined;
};

export type PublicOrg = {
  readonly id: string;
  readonly name: string;
  readonly verified: boolean;
  readonly legalForm?: string | undefined;
};

export type PublicFundMoney = {
  readonly totalRaised: Paise;
  readonly totalSpent: Paise;
  readonly currentBalance: Paise;
};

export type PublicFund = {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly org: PublicOrg;
  readonly money: PublicFundMoney;
  readonly spendingBreakdown: readonly SpendingCategory[];
  readonly timeline: readonly PublicTimelineEntry[];
  readonly upiPayee?:
    | {
        readonly vpa: string;
        readonly payeeName: string;
      }
    | undefined;
};

/**
 * Raw fund record that may contain internal private or PII fields
 * which must never leak to public pages or SSR HTML.
 */
export type RawFundRecord = {
  id: string;
  title?: string | undefined;
  name?: string | undefined;
  purpose?: string | undefined;
  description?: string | undefined;
  phone?: string | undefined;
  contact_phone?: string | undefined;
  bank_account_number?: string | undefined;
  ifsc_code?: string | undefined;
  org: {
    id: string;
    name: string;
    verified?: boolean | undefined;
    legal_form?: string | undefined;
    owner_id?: string | undefined;
    owner_phone?: string | undefined;
  };
  target_paise?: bigint | string | number | undefined;
  total_raised_paise?: bigint | string | number | undefined;
  total_spent_paise?: bigint | string | number | undefined;
  spending_categories?:
    | Array<{
        category: string;
        amount_paise: bigint | string | number;
      }>
    | undefined;
  timeline?:
    | Array<{
        id: string;
        type: "donation" | "expense";
        title?: string | undefined;
        description?: string | undefined;
        amount_paise: bigint | string | number;
        occurred_at?: string | undefined;
        created_at?: string | undefined;
        category?: string | undefined;
        status?: "verified" | "pending" | "unmatched" | "rejected" | undefined;
        donor_name?: string | undefined;
        donor_phone?: string | undefined;
        donor_user_id?: string | undefined;
        approver_ids?: string[] | undefined;
        evidence?:
          | {
              id: string;
              title?: string | undefined;
              url?: string | undefined;
              content_sha256?: string | undefined;
            }
          | undefined;
        merkle_root?: string | undefined;
        proof_url?: string | undefined;
      }>
    | undefined;
  upi_vpa?: string | undefined;
  upi_payee_name?: string | undefined;
};
