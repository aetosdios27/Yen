import type { Paise } from "@yen/shared";

export type TransactionType = "credit" | "debit";
export type TransactionSource = "statement_upload" | "webhook_partner";
export type ReconciliationStatus =
  | "unmatched"
  | "matched"
  | "manually_matched"
  | "ignored"
  | "ambiguous";
export type MatchMethod = "exact_utr" | "heuristic_amount_time" | "manual";

export interface ParsedBankTransaction {
  fundId: string;
  bankReference: string;
  utr?: string | undefined;
  amountPaise: Paise;
  type: TransactionType;
  postedAt: string; // ISO-8601 UTC string
  narration?: string | undefined;
  counterpartyVpa?: string | undefined;
  counterpartyAccountFingerprint?: string | undefined;
  counterpartyName?: string | undefined;
  source: TransactionSource;
  rawPayload: Record<string, unknown>;
}

export interface IngestedTransactionSummary {
  id: string;
  bankReference: string;
  utr?: string | undefined;
  amountPaise: Paise;
  type: TransactionType;
  reconciliationStatus: ReconciliationStatus;
  matchedPledgeId?: string | undefined;
  duplicate?: boolean | undefined;
}

export interface IngestResult {
  totalProcessed: number;
  ingestedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  duplicateCount: number;
  transactions: IngestedTransactionSummary[];
}

export interface CandidatePledge {
  pledgeId: string;
  amountPaise: Paise;
  utr: string;
  donorName?: string | undefined;
  createdAt: string;
  timeDifferenceHours: number;
}

export interface UnmatchedCreditWithCandidates {
  id: string;
  fundId: string;
  bankReference: string;
  utr?: string | undefined;
  amountPaise: Paise;
  postedAt: string;
  narration?: string | undefined;
  counterpartyVpa?: string | undefined;
  candidates: CandidatePledge[];
}

export type ManualMatchResult =
  | {
      readonly kind: "matched";
      readonly bankTransactionId: string;
      readonly pledgeId: string;
      readonly amountPaise: Paise;
      readonly matchedAt: string;
    }
  | { readonly kind: "bank_transaction_not_found" }
  | { readonly kind: "pledge_not_found" }
  | { readonly kind: "amount_mismatch"; readonly expectedPaise: Paise; readonly actualPaise: Paise }
  | { readonly kind: "already_matched" };
