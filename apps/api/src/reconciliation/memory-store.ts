import type { Paise } from "@yen/shared";
import { type MatchCandidate, matchCredit } from "./matching-engine.js";
import type {
  CandidatePledge,
  IngestedTransactionSummary,
  IngestResult,
  ManualMatchResult,
  ParsedBankTransaction,
  UnmatchedCreditWithCandidates,
} from "./types.js";

export interface StoredBankTransaction extends ParsedBankTransaction {
  id: string;
  reconciliationStatus: "unmatched" | "matched" | "manually_matched" | "ignored";
  matchedPledgeId?: string | undefined;
  matchedAt?: string | undefined;
  matchConfidence?: number | undefined;
  matchMethod?: "exact_utr" | "heuristic_amount_time" | "manual" | undefined;
  manualMatchReason?: string | undefined;
  manualMatchBy?: string | undefined;
  createdAt: string;
}

export interface StoredPledge {
  id: string;
  fundId: string;
  amountPaise: Paise;
  utr: string;
  donorName?: string | undefined;
  donorContact?: string | undefined;
  status: "pledged" | "verified" | "rejected";
  createdAt: string;
  verifiedAt?: string | undefined;
}

export interface ManualMatchRequest {
  fundId: string;
  bankTransactionId: string;
  pledgeId: string;
  reason: string;
  actorPseudonym?: string | undefined;
}

export interface ReconciliationStore {
  ingest(transactions: ParsedBankTransaction[]): Promise<IngestResult>;
  getUnmatchedCredits(fundId: string): Promise<UnmatchedCreditWithCandidates[]>;
  manualMatch(request: ManualMatchRequest): Promise<ManualMatchResult>;
  addPledge(pledge: StoredPledge): void;
}

export class MemoryReconciliationStore implements ReconciliationStore {
  private readonly transactions = new Map<string, StoredBankTransaction>();
  private readonly pledges = new Map<string, StoredPledge>();
  // Unique index on (fundId, bankReference) for idempotency
  private readonly referenceIndex = new Map<string, string>();

  addPledge(pledge: StoredPledge): void {
    this.pledges.set(pledge.id, { ...pledge });
    // Out-of-order check: if there is an unmatched credit in this fund that matches this new pledge, reconcile it!
    this.reconcileLatePledge(pledge);
  }

  private reconcileLatePledge(pledge: StoredPledge): void {
    if (pledge.status !== "pledged") return;

    for (const tx of this.transactions.values()) {
      if (
        tx.fundId === pledge.fundId &&
        tx.type === "credit" &&
        tx.reconciliationStatus === "unmatched"
      ) {
        const candidate: MatchCandidate = {
          pledgeId: pledge.id,
          fundId: pledge.fundId,
          amountPaise: pledge.amountPaise,
          utr: pledge.utr,
          donorName: pledge.donorName,
          donorContact: pledge.donorContact,
          createdAt: pledge.createdAt,
        };

        const decision = matchCredit(tx, [candidate]);
        if (decision.status === "matched") {
          tx.reconciliationStatus = "matched";
          tx.matchedPledgeId = pledge.id;
          tx.matchedAt = new Date().toISOString();
          tx.matchMethod = decision.method;
          tx.matchConfidence = decision.confidence;

          pledge.status = "verified";
          pledge.verifiedAt = tx.matchedAt;
          break;
        }
      }
    }
  }

  async ingest(transactions: ParsedBankTransaction[]): Promise<IngestResult> {
    let ingestedCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let duplicateCount = 0;
    const summaries: IngestedTransactionSummary[] = [];

    for (const tx of transactions) {
      const dedupeKey = `${tx.fundId}:${tx.bankReference}`;
      const existingId = this.referenceIndex.get(dedupeKey);

      if (existingId) {
        const existing = this.transactions.get(existingId);
        if (existing) {
          duplicateCount++;
          summaries.push({
            id: existing.id,
            bankReference: existing.bankReference,
            utr: existing.utr,
            amountPaise: existing.amountPaise,
            type: existing.type,
            reconciliationStatus: existing.reconciliationStatus,
            matchedPledgeId: existing.matchedPledgeId,
            duplicate: true,
          });
          continue;
        }
      }

      const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      const stored: StoredBankTransaction = {
        ...tx,
        id,
        reconciliationStatus: "unmatched",
        createdAt: now,
      };

      if (tx.type === "credit") {
        // Collect active pledges in this fund
        const availablePledges: MatchCandidate[] = [];
        for (const p of this.pledges.values()) {
          if (p.fundId === tx.fundId && p.status === "pledged") {
            availablePledges.push({
              pledgeId: p.id,
              fundId: p.fundId,
              amountPaise: p.amountPaise,
              utr: p.utr,
              donorName: p.donorName,
              donorContact: p.donorContact,
              createdAt: p.createdAt,
            });
          }
        }

        const decision = matchCredit(tx, availablePledges);
        if (decision.status === "matched") {
          stored.reconciliationStatus = "matched";
          stored.matchedPledgeId = decision.pledgeId;
          stored.matchedAt = now;
          stored.matchConfidence = decision.confidence;
          stored.matchMethod = decision.method;

          const pledge = this.pledges.get(decision.pledgeId);
          if (pledge) {
            pledge.status = "verified";
            pledge.verifiedAt = now;
          }
          matchedCount++;
        } else {
          unmatchedCount++;
        }
      }

      this.transactions.set(id, stored);
      this.referenceIndex.set(dedupeKey, id);
      ingestedCount++;

      summaries.push({
        id,
        bankReference: stored.bankReference,
        utr: stored.utr,
        amountPaise: stored.amountPaise,
        type: stored.type,
        reconciliationStatus: stored.reconciliationStatus,
        matchedPledgeId: stored.matchedPledgeId,
      });
    }

    return {
      totalProcessed: transactions.length,
      ingestedCount,
      matchedCount,
      unmatchedCount,
      duplicateCount,
      transactions: summaries,
    };
  }

  async getUnmatchedCredits(fundId: string): Promise<UnmatchedCreditWithCandidates[]> {
    const unmatched: UnmatchedCreditWithCandidates[] = [];

    // Get available pending pledges in this fund
    const pendingPledges: MatchCandidate[] = [];
    for (const p of this.pledges.values()) {
      if (p.fundId === fundId && p.status === "pledged") {
        pendingPledges.push({
          pledgeId: p.id,
          fundId: p.fundId,
          amountPaise: p.amountPaise,
          utr: p.utr,
          donorName: p.donorName,
          donorContact: p.donorContact,
          createdAt: p.createdAt,
        });
      }
    }

    for (const tx of this.transactions.values()) {
      if (tx.fundId === fundId && tx.type === "credit" && tx.reconciliationStatus === "unmatched") {
        // Find candidate pledges (matching exact amount within 72 hours)
        const txTime = new Date(tx.postedAt).getTime();
        const candidates: CandidatePledge[] = [];

        for (const p of pendingPledges) {
          if (p.amountPaise === tx.amountPaise) {
            const pTime = new Date(p.createdAt).getTime();
            const diffHours = Math.round(Math.abs(txTime - pTime) / (60 * 60 * 1000));
            candidates.push({
              pledgeId: p.pledgeId,
              amountPaise: p.amountPaise,
              utr: p.utr,
              donorName: p.donorName,
              createdAt: p.createdAt,
              timeDifferenceHours: diffHours,
            });
          }
        }

        unmatched.push({
          id: tx.id,
          fundId: tx.fundId,
          bankReference: tx.bankReference,
          utr: tx.utr,
          amountPaise: tx.amountPaise,
          postedAt: tx.postedAt,
          narration: tx.narration,
          counterpartyVpa: tx.counterpartyVpa,
          candidates,
        });
      }
    }

    return unmatched.sort(
      (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
    );
  }

  async manualMatch(request: ManualMatchRequest): Promise<ManualMatchResult> {
    const tx = this.transactions.get(request.bankTransactionId);
    if (!tx || tx.fundId !== request.fundId) {
      return { kind: "bank_transaction_not_found" };
    }
    if (tx.reconciliationStatus !== "unmatched" || tx.type !== "credit") {
      return { kind: "already_matched" };
    }

    const pledge = this.pledges.get(request.pledgeId);
    if (!pledge || pledge.fundId !== request.fundId) {
      return { kind: "pledge_not_found" };
    }
    if (pledge.status !== "pledged") {
      return { kind: "already_matched" };
    }

    if (tx.amountPaise !== pledge.amountPaise) {
      return {
        kind: "amount_mismatch",
        expectedPaise: tx.amountPaise,
        actualPaise: pledge.amountPaise,
      };
    }

    const now = new Date().toISOString();
    tx.reconciliationStatus = "manually_matched";
    tx.matchedPledgeId = pledge.id;
    tx.matchedAt = now;
    tx.matchMethod = "manual";
    tx.matchConfidence = 1.0;
    tx.manualMatchReason = request.reason;
    tx.manualMatchBy = request.actorPseudonym;

    pledge.status = "verified";
    pledge.verifiedAt = now;

    return {
      kind: "matched",
      bankTransactionId: tx.id,
      pledgeId: pledge.id,
      amountPaise: tx.amountPaise,
      matchedAt: now,
    };
  }
}
