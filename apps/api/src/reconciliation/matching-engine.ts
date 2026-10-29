import type { Paise } from "@yen/shared";
import type { MatchMethod, ParsedBankTransaction } from "./types.js";

export interface MatchCandidate {
  pledgeId: string;
  fundId: string;
  amountPaise: Paise;
  utr: string;
  donorName?: string | undefined;
  donorContact?: string | undefined;
  createdAt: string; // ISO-8601
}

export type MatchDecision =
  | {
      readonly status: "matched";
      readonly method: MatchMethod;
      readonly confidence: number;
      readonly pledgeId: string;
    }
  | {
      readonly status: "ambiguous";
      readonly candidates: MatchCandidate[];
    }
  | {
      readonly status: "unmatched";
    };

export interface MatchingOptions {
  /** Maximum time difference between pledge creation and transaction post time in hours (default 72h) */
  timeWindowHours?: number;
}

/**
 * Pure credit matching engine.
 * 1. Tier 1: Exact 12-digit UPI UTR match against available pledges.
 * 2. Tier 2: Secondary heuristic match on exact Paise amount + time window.
 * 3. Ambiguous matches (multiple candidates) are routed to review.
 */
export function matchCredit(
  transaction: ParsedBankTransaction,
  availablePledges: readonly MatchCandidate[],
  options: MatchingOptions = {},
): MatchDecision {
  if (transaction.type !== "credit") {
    return { status: "unmatched" };
  }

  const fundPledges = availablePledges.filter((p) => p.fundId === transaction.fundId);
  if (fundPledges.length === 0) {
    return { status: "unmatched" };
  }

  // Tier 1: Exact 12-digit UPI UTR Match
  if (transaction.utr && /^[0-9]{12}$/.test(transaction.utr)) {
    const utrMatches = fundPledges.filter((p) => p.utr === transaction.utr);
    if (utrMatches.length === 1) {
      const match = utrMatches[0];
      if (match && match.amountPaise === transaction.amountPaise) {
        return {
          status: "matched",
          method: "exact_utr",
          confidence: 1.0,
          pledgeId: match.pledgeId,
        };
      }
    }
  }

  // Tier 2: Heuristic Match on Exact Paise + Time Window
  const timeWindowHours = options.timeWindowHours ?? 72;
  const timeWindowMs = timeWindowHours * 60 * 60 * 1000;
  const txTime = new Date(transaction.postedAt).getTime();

  const heuristicCandidates = fundPledges.filter((pledge) => {
    // Exact paise match is mandatory
    if (pledge.amountPaise !== transaction.amountPaise) {
      return false;
    }
    const pledgeTime = new Date(pledge.createdAt).getTime();
    if (Number.isNaN(pledgeTime) || Number.isNaN(txTime)) {
      return false;
    }
    const diff = Math.abs(txTime - pledgeTime);
    return diff <= timeWindowMs;
  });

  if (heuristicCandidates.length === 1) {
    const single = heuristicCandidates[0];
    if (single) {
      return {
        status: "matched",
        method: "heuristic_amount_time",
        confidence: 0.85,
        pledgeId: single.pledgeId,
      };
    }
  }

  if (heuristicCandidates.length > 1) {
    return {
      status: "ambiguous",
      candidates: heuristicCandidates,
    };
  }

  return { status: "unmatched" };
}
