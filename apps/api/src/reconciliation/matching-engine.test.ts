import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { type MatchCandidate, matchCredit } from "./matching-engine.js";
import type { ParsedBankTransaction } from "./types.js";

describe("Credit Matching Engine", () => {
  const fundId = "e3fb2fc4-03f9-45b1-bcef-464ab0d87ddd";

  const pledge1: MatchCandidate = {
    pledgeId: "p1111111-1111-4111-8111-111111111111",
    fundId,
    amountPaise: paise(50000),
    utr: "123456789012",
    donorName: "Asha Rao",
    createdAt: "2026-10-28T10:00:00.000Z",
  };

  const pledge2: MatchCandidate = {
    pledgeId: "p2222222-2222-4222-8222-222222222222",
    fundId,
    amountPaise: paise(25000),
    utr: "234567890123",
    donorName: "Rahul Sharma",
    createdAt: "2026-10-28T11:00:00.000Z",
  };

  const sampleTx: ParsedBankTransaction = {
    fundId,
    bankReference: "BANK_TX_001",
    utr: "123456789012",
    amountPaise: paise(50000),
    type: "credit",
    postedAt: "2026-10-28T12:00:00.000Z",
    source: "statement_upload",
    rawPayload: {},
  };

  it("matches exactly on 12-digit UPI UTR with confidence 1.0", () => {
    const decision = matchCredit(sampleTx, [pledge1, pledge2]);
    expect(decision).toEqual({
      status: "matched",
      method: "exact_utr",
      confidence: 1.0,
      pledgeId: pledge1.pledgeId,
    });
  });

  it("does not match on UTR if the amount differs", () => {
    const mismatchedTx = { ...sampleTx, amountPaise: paise(60000) };
    const decision = matchCredit(mismatchedTx, [pledge1, pledge2]);
    expect(decision.status).toBe("unmatched");
  });

  it("matches via secondary heuristic (exact Paise + time window) when UTR is absent", () => {
    // Transaction from IMPS or non-standard UPI narration with no 12-digit UTR
    const noUtrTx: ParsedBankTransaction = {
      fundId,
      bankReference: "IMPS_REF_999",
      amountPaise: paise(25000),
      type: "credit",
      postedAt: "2026-10-28T14:00:00.000Z",
      source: "statement_upload",
      rawPayload: {},
    };

    const decision = matchCredit(noUtrTx, [pledge1, pledge2]);
    expect(decision).toEqual({
      status: "matched",
      method: "heuristic_amount_time",
      confidence: 0.85,
      pledgeId: pledge2.pledgeId,
    });
  });

  it("does not match via heuristic if outside the time window", () => {
    const oldTx: ParsedBankTransaction = {
      fundId,
      bankReference: "OLD_TX",
      amountPaise: paise(25000),
      type: "credit",
      postedAt: "2026-11-15T10:00:00.000Z", // 18 days later (> 72 hours)
      source: "statement_upload",
      rawPayload: {},
    };

    const decision = matchCredit(oldTx, [pledge1, pledge2]);
    expect(decision.status).toBe("unmatched");
  });

  it("routes ambiguous matches to review when multiple candidate pledges exist for the same amount", () => {
    const pledge3: MatchCandidate = {
      pledgeId: "p3333333-3333-4333-8333-333333333333",
      fundId,
      amountPaise: paise(25000), // Same amount as pledge2!
      utr: "999888777666",
      donorName: "Another Donor",
      createdAt: "2026-10-28T12:00:00.000Z",
    };

    const ambiguousTx: ParsedBankTransaction = {
      fundId,
      bankReference: "UNKNOWN_DONOR_250",
      amountPaise: paise(25000),
      type: "credit",
      postedAt: "2026-10-28T13:00:00.000Z",
      source: "statement_upload",
      rawPayload: {},
    };

    const decision = matchCredit(ambiguousTx, [pledge1, pledge2, pledge3]);
    expect(decision.status).toBe("ambiguous");
    if (decision.status === "ambiguous") {
      expect(decision.candidates.length).toBe(2);
      expect(decision.candidates.map((c) => c.pledgeId)).toEqual([
        pledge2.pledgeId,
        pledge3.pledgeId,
      ]);
    }
  });

  it("never matches debits", () => {
    const debitTx: ParsedBankTransaction = {
      fundId,
      bankReference: "DEBIT_001",
      utr: "123456789012",
      amountPaise: paise(50000),
      type: "debit",
      postedAt: "2026-10-28T12:00:00.000Z",
      source: "statement_upload",
      rawPayload: {},
    };

    expect(matchCredit(debitTx, [pledge1])).toEqual({ status: "unmatched" });
  });
});
