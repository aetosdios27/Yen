import { type Sql, uuidv7 } from "@yen/db";
import { acquireFundLockInTx, reconcilePledge } from "@yen/ledger";
import { paise } from "@yen/shared";
import { type MatchCandidate, matchCredit } from "./matching-engine.js";
import type { ManualMatchRequest, ReconciliationStore, StoredPledge } from "./memory-store.js";
import type {
  CandidatePledge,
  IngestedTransactionSummary,
  IngestResult,
  ManualMatchResult,
  ParsedBankTransaction,
  UnmatchedCreditWithCandidates,
} from "./types.js";

export class PostgresReconciliationStore implements ReconciliationStore {
  constructor(private readonly sql: Sql) {}

  addPledge(_pledge: StoredPledge): void {
    // In Postgres, pledges are inserted directly into donation_pledges via pledgeDonation.
  }

  async ingest(transactions: ParsedBankTransaction[]): Promise<IngestResult> {
    if (transactions.length === 0) {
      return {
        totalProcessed: 0,
        ingestedCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        duplicateCount: 0,
        transactions: [],
      };
    }

    const fundId = transactions[0]?.fundId;
    if (!fundId) {
      throw new Error("Missing fundId in transaction batch");
    }

    return this.sql.begin(async (tx) => {
      // Serialize ingestion per-fund using PostgreSQL advisory transaction lock
      await acquireFundLockInTx(tx, fundId);

      let ingestedCount = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let duplicateCount = 0;
      const summaries: IngestedTransactionSummary[] = [];

      for (const t of transactions) {
        // Idempotency check: see if (fund_id, bank_reference) exists
        const existing = await tx<
          {
            id: string;
            bank_reference: string;
            utr: string | null;
            amount_paise: string;
            type: "credit" | "debit";
            reconciliation_status: "unmatched" | "matched" | "manually_matched" | "ignored";
            matched_pledge_id: string | null;
          }[]
        >`
          SELECT id, bank_reference, utr, amount_paise::text, type, reconciliation_status, matched_pledge_id
          FROM bank_transactions
          WHERE fund_id = ${t.fundId} AND bank_reference = ${t.bankReference}
          LIMIT 1
        `;

        if (existing[0]) {
          duplicateCount++;
          summaries.push({
            id: existing[0].id,
            bankReference: existing[0].bank_reference,
            utr: existing[0].utr ?? undefined,
            amountPaise: paise(Number(existing[0].amount_paise)),
            type: existing[0].type,
            reconciliationStatus: existing[0].reconciliation_status,
            matchedPledgeId: existing[0].matched_pledge_id ?? undefined,
            duplicate: true,
          });
          continue;
        }

        const id = uuidv7();
        await tx`
          INSERT INTO bank_transactions (
            id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
            narration, counterparty_vpa, counterparty_name, source, raw_payload,
            reconciliation_status
          ) VALUES (
            ${id}, ${t.fundId}, ${t.bankReference}, ${t.utr ?? null},
            ${t.amountPaise.toString()}, ${t.type}, ${t.postedAt},
            ${t.narration ?? null}, ${t.counterpartyVpa ?? null},
            ${t.counterpartyName ?? null}, ${t.source}, ${tx.json(t.rawPayload as Parameters<typeof tx.json>[0])},
            'unmatched'
          )
        `;
        ingestedCount++;

        let reconciliationStatus: "unmatched" | "matched" = "unmatched";
        let matchedPledgeId: string | undefined;

        if (t.type === "credit") {
          // Query pending pledges for this fund
          const pendingPledges = await tx<
            {
              id: string;
              fund_id: string;
              amount_paise: string;
              utr: string;
              donor_display_name: string | null;
              donor_contact: string | null;
              created_at: Date;
            }[]
          >`
            SELECT id, fund_id, amount_paise::text, utr, donor_display_name, donor_contact, created_at
            FROM donation_pledges
            WHERE fund_id = ${t.fundId} AND status = 'pledged'
            ORDER BY created_at ASC
          `;

          const candidates: MatchCandidate[] = pendingPledges.map((p) => ({
            pledgeId: p.id,
            fundId: p.fund_id,
            amountPaise: paise(Number(p.amount_paise)),
            utr: p.utr,
            donorName: p.donor_display_name ?? undefined,
            donorContact: p.donor_contact ?? undefined,
            createdAt: p.created_at.toISOString(),
          }));

          const decision = matchCredit(t, candidates);
          if (decision.status === "matched") {
            const recon = await reconcilePledge(tx, {
              fundId: t.fundId,
              pledgeId: decision.pledgeId,
              bankTransactionId: id,
              matchMethod: decision.method,
              matchConfidence: decision.confidence,
            });

            if (recon.kind === "reconciled") {
              reconciliationStatus = "matched";
              matchedPledgeId = decision.pledgeId;
              matchedCount++;
            } else {
              unmatchedCount++;
            }
          } else {
            unmatchedCount++;
          }
        }

        summaries.push({
          id,
          bankReference: t.bankReference,
          utr: t.utr,
          amountPaise: t.amountPaise,
          type: t.type,
          reconciliationStatus,
          matchedPledgeId,
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
    });
  }

  async getUnmatchedCredits(fundId: string): Promise<UnmatchedCreditWithCandidates[]> {
    const unmatchedRows = await this.sql<
      {
        id: string;
        fund_id: string;
        bank_reference: string;
        utr: string | null;
        amount_paise: string;
        posted_at: Date;
        narration: string | null;
        counterparty_vpa: string | null;
      }[]
    >`
      SELECT id, fund_id, bank_reference, utr, amount_paise::text, posted_at, narration, counterparty_vpa
      FROM bank_transactions
      WHERE fund_id = ${fundId} AND type = 'credit' AND reconciliation_status = 'unmatched'
      ORDER BY posted_at DESC
    `;

    if (unmatchedRows.length === 0) return [];

    const pendingPledges = await this.sql<
      {
        id: string;
        amount_paise: string;
        utr: string;
        donor_display_name: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, amount_paise::text, utr, donor_display_name, created_at
      FROM donation_pledges
      WHERE fund_id = ${fundId} AND status = 'pledged'
      ORDER BY created_at ASC
    `;

    return unmatchedRows.map((row) => {
      const txTime = row.posted_at.getTime();
      const amount = paise(Number(row.amount_paise));

      const candidates: CandidatePledge[] = [];
      for (const p of pendingPledges) {
        const pledgeAmount = paise(Number(p.amount_paise));
        if (pledgeAmount === amount) {
          const diffHours = Math.round(
            Math.abs(txTime - p.created_at.getTime()) / (60 * 60 * 1000),
          );
          if (diffHours <= 72) {
            candidates.push({
              pledgeId: p.id,
              amountPaise: pledgeAmount,
              utr: p.utr,
              donorName: p.donor_display_name ?? undefined,
              createdAt: p.created_at.toISOString(),
              timeDifferenceHours: diffHours,
            });
          }
        }
      }

      return {
        id: row.id,
        fundId: row.fund_id,
        bankReference: row.bank_reference,
        utr: row.utr ?? undefined,
        amountPaise: amount,
        postedAt: row.posted_at.toISOString(),
        narration: row.narration ?? undefined,
        counterpartyVpa: row.counterparty_vpa ?? undefined,
        candidates,
      };
    });
  }

  async manualMatch(request: ManualMatchRequest): Promise<ManualMatchResult> {
    return this.sql.begin(async (tx) => {
      await acquireFundLockInTx(tx, request.fundId);

      const txRows = await tx<
        {
          id: string;
          fund_id: string;
          amount_paise: string;
          reconciliation_status: string;
          type: string;
        }[]
      >`
        SELECT id, fund_id, amount_paise::text, reconciliation_status, type
        FROM bank_transactions
        WHERE id = ${request.bankTransactionId}
        FOR UPDATE
      `;

      if (txRows.length === 0 || txRows[0]?.fund_id !== request.fundId) {
        return { kind: "bank_transaction_not_found" };
      }
      const bankTx = txRows[0];
      if (bankTx.reconciliation_status !== "unmatched" || bankTx.type !== "credit") {
        return { kind: "already_matched" };
      }

      const pledgeRows = await tx<
        {
          id: string;
          fund_id: string;
          amount_paise: string;
          status: string;
        }[]
      >`
        SELECT id, fund_id, amount_paise::text, status
        FROM donation_pledges
        WHERE id = ${request.pledgeId}
        FOR UPDATE
      `;

      if (pledgeRows.length === 0 || pledgeRows[0]?.fund_id !== request.fundId) {
        return { kind: "pledge_not_found" };
      }
      const pledge = pledgeRows[0];
      if (pledge.status !== "pledged") {
        return { kind: "already_matched" };
      }

      const txAmount = paise(Number(bankTx.amount_paise));
      const pledgeAmount = paise(Number(pledge.amount_paise));
      if (txAmount !== pledgeAmount) {
        return {
          kind: "amount_mismatch",
          expectedPaise: txAmount,
          actualPaise: pledgeAmount,
        };
      }

      const recon = await reconcilePledge(tx, {
        fundId: request.fundId,
        pledgeId: request.pledgeId,
        bankTransactionId: request.bankTransactionId,
        matchMethod: "manual",
        matchConfidence: 1.0,
        auditReason: request.reason,
        ...(request.actorPseudonym ? { actorPseudonym: request.actorPseudonym } : {}),
      });

      if (recon.kind !== "reconciled") {
        throw new Error(`Failed to reconcile pledge: ${recon.kind}`);
      }

      return {
        kind: "matched",
        bankTransactionId: request.bankTransactionId,
        pledgeId: request.pledgeId,
        amountPaise: txAmount,
        matchedAt: new Date().toISOString(),
      };
    });
  }
}
