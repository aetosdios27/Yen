import { randomUUID } from "node:crypto";
import { alertEscalationMinutes, type Sql, uuidv7 } from "@yen/db";
import { getBalances, recordDonation } from "@yen/ledger";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  createTestFund,
  ledgerDatabaseSuite,
} from "../../../../packages/ledger/src/test/database.js";
import {
  INTEGRITY_JOB_ALERT_KEY,
  runPersistedEvidenceIntegrityJobWithAlert,
} from "../evidence-integrity-runner.js";
import type { StorageAdapter } from "../storage.js";
import { checkBankBalance, matchDebitInTx } from "./debit-matching.js";
import type { ParsedBankTransaction } from "./types.js";

type AlertRowLite = {
  fund_id: string | null;
  alert_type: string;
  severity: string;
  entity_type: string | null;
  entity_id: string | null;
  dedup_key: string | null;
  escalation_due_at: Date | null;
  created_at: Date;
};

async function insertBankDebit(sql: Sql, fundId: string, amountPaise: number): Promise<string> {
  const id = uuidv7();
  await sql`
    INSERT INTO bank_transactions (
      id, fund_id, bank_reference, amount_paise, type, posted_at, source, raw_payload
    ) VALUES (
      ${id}, ${fundId}, ${`debit-${randomUUID()}`}, ${amountPaise}, 'debit',
      ${new Date().toISOString()}, 'statement_upload', '{}'::jsonb
    )`;
  return id;
}

async function alertsOfType(sql: Sql, alertType: string, fundId: string | null) {
  return sql<AlertRowLite[]>`
    SELECT fund_id, alert_type, severity, entity_type, entity_id, dedup_key,
           escalation_due_at, created_at
    FROM alerts
    WHERE alert_type = ${alertType}
      AND fund_id IS NOT DISTINCT FROM ${fundId}
  `;
}

ledgerDatabaseSuite("alert detection (reconciliation and integrity)", (sql) => {
  describe("unapproved_debit", () => {
    it("raises one warning alert per unmatched debit and dedups a repeat match attempt", async () => {
      const fundId = await createTestFund(sql);
      const bankTransactionId = await insertBankDebit(sql, fundId, 1_500);
      const debit: ParsedBankTransaction = {
        fundId,
        bankReference: `ref-${randomUUID()}`,
        amountPaise: paise(1_500),
        type: "debit",
        postedAt: new Date().toISOString(),
        source: "statement_upload",
        rawPayload: {},
      };

      const first = await sql.begin((tx) => matchDebitInTx(tx, debit, bankTransactionId));
      expect(first).toEqual({ kind: "unapproved" });
      const raised = await alertsOfType(sql, "unapproved_debit", fundId);
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        fund_id: fundId,
        severity: "warning",
        entity_type: "bank_transaction",
        entity_id: bankTransactionId,
        dedup_key: bankTransactionId,
      });

      const second = await sql.begin((tx) => matchDebitInTx(tx, debit, bankTransactionId));
      expect(second).toEqual({ kind: "unapproved" });
      expect(await alertsOfType(sql, "unapproved_debit", fundId)).toHaveLength(1);
    });
  });

  describe("balance_drift", () => {
    it("does not alert when the ledger and reported bank balances agree", async () => {
      const fundId = await createTestFund(sql);
      await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10_000) }));
      const result = await checkBankBalance(sql, fundId, 10_000n, { emit: async () => {} });
      expect(result.matches).toBe(true);
      expect(await alertsOfType(sql, "balance_drift", fundId)).toHaveLength(0);
    });

    it("raises one critical alert with an escalation deadline on drift, and dedups repeat checks", async () => {
      const fundId = await createTestFund(sql);
      await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10_000) }));
      const ledger = await sql.begin(async (tx) => (await getBalances(tx, fundId)).bankPaise);
      expect(ledger).toBe(10_000n);

      const drift = await checkBankBalance(sql, fundId, 9_999n, { emit: async () => {} });
      expect(drift.matches).toBe(false);
      const raised = await alertsOfType(sql, "balance_drift", fundId);
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        fund_id: fundId,
        severity: "critical",
        entity_type: "fund",
        entity_id: fundId,
      });
      const row = raised[0];
      const due = row?.escalation_due_at;
      if (!row || !due) throw new Error("Critical balance drift must set escalation_due_at");
      const delayMs = due.getTime() - row.created_at.getTime();
      const expectedMs = alertEscalationMinutes() * 60 * 1000;
      expect(Math.abs(delayMs - expectedMs)).toBeLessThan(5_000);

      await checkBankBalance(sql, fundId, 9_998n, { emit: async () => {} });
      expect(await alertsOfType(sql, "balance_drift", fundId)).toHaveLength(1);
    });
  });

  describe("integrity_check_failure", () => {
    const unusedStorage = {} as unknown as StorageAdapter;

    it("does not alert when the persisted integrity job completes", async () => {
      const store = { scanPage: async () => [] };
      const summary = await runPersistedEvidenceIntegrityJobWithAlert(sql, store, unusedStorage);
      expect(summary.totalChecked).toBe(0);
      expect(await alertsOfType(sql, "integrity_check_failure", null)).toHaveLength(0);
    });

    it("raises one critical platform alert with no fund when the job throws, and dedups repeat failures", async () => {
      const failingStore = {
        scanPage: async (): Promise<never> => {
          throw new Error("evidence store unavailable");
        },
      };

      await expect(
        runPersistedEvidenceIntegrityJobWithAlert(sql, failingStore, unusedStorage),
      ).rejects.toThrow("evidence store unavailable");
      const raised = await alertsOfType(sql, "integrity_check_failure", null);
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        fund_id: null,
        severity: "critical",
        entity_type: "integrity_job",
        entity_id: INTEGRITY_JOB_ALERT_KEY,
        dedup_key: INTEGRITY_JOB_ALERT_KEY,
      });

      await expect(
        runPersistedEvidenceIntegrityJobWithAlert(sql, failingStore, unusedStorage),
      ).rejects.toThrow("evidence store unavailable");
      expect(await alertsOfType(sql, "integrity_check_failure", null)).toHaveLength(1);
    });
  });
});
