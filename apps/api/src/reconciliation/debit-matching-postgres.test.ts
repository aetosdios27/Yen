import { randomUUID } from "node:crypto";
import { type Sql, uuidv7 } from "@yen/db";
import { getBalances, getFundEvents, recordDonation, reserveForExpense } from "@yen/ledger";
import { paise } from "@yen/shared";
import { expect, it } from "vitest";
import {
  createTestFund,
  ledgerDatabaseSuite,
} from "../../../../packages/ledger/src/test/database.js";
import { checkBankBalance } from "./debit-matching.js";
import { PostgresReconciliationStore } from "./postgres-store.js";

async function createApprovedExpense(
  sql: Sql,
  fundId: string,
  amount: number,
  recipientRef: string,
) {
  const hold = await sql.begin((tx) =>
    reserveForExpense(tx, { fundId, amount: paise(amount), description: "Test expense" }),
  );
  const now = new Date().toISOString();
  const expenseData = {
    id: hold.expenseId,
    fundId,
    requesterId: `psn_${randomUUID()}`,
    amountPaise: amount,
    description: "Test expense",
    recipientRef,
    status: "approved",
    holdId: hold.holdId,
    approvals: [],
    evidence: [],
    supersedesId: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    objectionEndsAt: now,
    approvedAt: now,
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: null,
    reconciledAt: null,
    bankTransactionId: null,
    expiresAt: null,
  };
  await sql`
    INSERT INTO expenses (id, fund_id, status, hold_id, expense_data, created_at, updated_at)
    VALUES (${hold.expenseId}, ${fundId}, 'approved', ${hold.holdId}, ${sql.json(expenseData)}, ${now}, ${now})
  `;
  return hold;
}

ledgerDatabaseSuite("Postgres debit matching", (sql) => {
  it("settles one exact approved debit atomically, and alerts without touching an unrelated hold", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10_000) }));
    const approved = await createApprovedExpense(sql, fundId, 1_000, "club.vendor@upi");
    const unrelated = await createApprovedExpense(sql, fundId, 500, "another.vendor@upi");
    const alerts: unknown[] = [];
    const store = new PostgresReconciliationStore(sql, {
      emit: async (alert) => {
        alerts.push(alert);
      },
    });
    const now = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const bankReference = `debit-${uuidv7()}`;

    await sql.unsafe(`CREATE FUNCTION yen_test_injected_debit_crash() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type = 'bank.debit_seen' THEN RAISE EXCEPTION 'injected crash'; END IF;
        RETURN NEW;
      END; $$`);
    await sql.unsafe(`CREATE TRIGGER yen_test_injected_debit_crash
      BEFORE INSERT ON fund_events FOR EACH ROW EXECUTE FUNCTION yen_test_injected_debit_crash()`);
    await expect(
      store.ingest([
        {
          fundId,
          bankReference: `crash-${uuidv7()}`,
          amountPaise: paise(1_000),
          type: "debit",
          postedAt: now,
          counterpartyVpa: "club.vendor@upi",
          source: "statement_upload",
          rawPayload: {},
        },
      ]),
    ).rejects.toThrow("injected crash");
    await sql.unsafe("DROP TRIGGER yen_test_injected_debit_crash ON fund_events");
    await sql.unsafe("DROP FUNCTION yen_test_injected_debit_crash()");
    const afterCrash = await sql<{ status: string }[]>`
      SELECT status FROM konto_holds WHERE id = ${approved.holdId}
    `;
    expect(afterCrash[0]?.status).toBe("PENDING");

    const matched = await store.ingest([
      {
        fundId,
        bankReference,
        amountPaise: paise(1_000),
        type: "debit",
        postedAt: now,
        counterpartyVpa: "club.vendor@upi",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    expect(matched.matchedCount).toBe(1);
    expect(matched.transactions[0]?.reconciliationStatus).toBe("matched");
    const replay = await store.ingest([
      {
        fundId,
        bankReference,
        amountPaise: paise(1_000),
        type: "debit",
        postedAt: now,
        counterpartyVpa: "club.vendor@upi",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    expect(replay.duplicateCount).toBe(1);

    const lateUnapproved = await store.ingest([
      {
        fundId,
        bankReference: `unapproved-${uuidv7()}`,
        amountPaise: paise(777),
        type: "debit",
        postedAt: now,
        counterpartyVpa: "unknown@upi",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    expect(lateUnapproved.unmatchedCount).toBe(1);
    expect(alerts).toHaveLength(1);
    const unapprovedRows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM unapproved_debits
      WHERE fund_id = ${fundId} AND resolved_at IS NULL
    `;
    expect(unapprovedRows[0]?.count).toBe(1);

    const rows = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM konto_holds
      WHERE id IN (${approved.holdId}, ${unrelated.holdId})
    `;
    expect(rows.find((row) => row.id === approved.holdId)?.status).toBe("COMMITTED");
    expect(rows.find((row) => row.id === unrelated.holdId)?.status).toBe("PENDING");

    const debitEvents = (await getFundEvents(sql, fundId)).filter(
      (event) => event.type === "expense.paid" || event.type === "bank.debit_seen",
    );
    expect(debitEvents.map((event) => event.type)).toEqual(["expense.paid", "bank.debit_seen"]);
    expect((await getBalances(sql, fundId)).bankPaise).toBe(9_000n);
    const consistencyAlerts: unknown[] = [];
    const check = await checkBankBalance(sql, fundId, 8_999n, {
      emit: async (alert) => {
        consistencyAlerts.push(alert);
      },
    });
    expect(check).toEqual({ matches: false, ledgerBalancePaise: 9_000n });
    expect(consistencyAlerts).toHaveLength(1);
  });

  it("queues a debit when multiple approved expenses have equal match signals", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10_000) }));
    const first = await createApprovedExpense(sql, fundId, 1_000, "club.vendor@upi");
    const second = await createApprovedExpense(sql, fundId, 1_000, "club.vendor@upi");
    const store = new PostgresReconciliationStore(sql, { emit: async () => {} });
    const result = await store.ingest([
      {
        fundId,
        bankReference: `ambiguous-${uuidv7()}`,
        amountPaise: paise(1_000),
        type: "debit",
        postedAt: new Date().toISOString(),
        counterpartyVpa: "club.vendor@upi",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    expect(result.transactions[0]?.reconciliationStatus).toBe("ambiguous");
    const holds = await sql<{ status: string; hold_id: string }[]>`
      SELECT status, id AS hold_id FROM konto_holds
      WHERE id IN (${first.holdId}, ${second.holdId})
    `;
    expect(holds).toHaveLength(2);
    expect(holds.every((hold) => hold.status === "PENDING")).toBe(true);
    expect(await getFundEvents(sql, fundId)).not.toContainEqual(
      expect.objectContaining({ type: "expense.paid" }),
    );
    const unmatch = await store.manualUnmatchDebit({
      fundId,
      bankTransactionId: result.transactions[0]?.id ?? "",
      reason: "No approved request is supported by the records",
      actorPseudonym: `psn_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
    });
    expect(unmatch.kind).toBe("updated");
    expect((await store.listDebitReview(fundId)).some((item) => item.kind === "unapproved")).toBe(
      true,
    );
    const actions = await sql<{ action: string; reason: string }[]>`
      SELECT action, reason FROM debit_reconciliation_actions
      WHERE bank_transaction_id = ${result.transactions[0]?.id ?? ""}
    `;
    expect(actions).toEqual([
      { action: "manual_unmatch", reason: "No approved request is supported by the records" },
    ]);
  });

  it("manually matches an unapproved debit with an owner reason and resolves its flag", async () => {
    const fundId = await createTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(10_000) }));
    const expense = await createApprovedExpense(sql, fundId, 1_000, "expected@upi");
    const store = new PostgresReconciliationStore(sql, { emit: async () => {} });
    const ingested = await store.ingest([
      {
        fundId,
        bankReference: `owner-match-${uuidv7()}`,
        amountPaise: paise(1_000),
        type: "debit",
        postedAt: new Date().toISOString(),
        counterpartyVpa: "different@upi",
        source: "statement_upload",
        rawPayload: {},
      },
    ]);
    const bankTransactionId = ingested.transactions[0]?.id ?? "";
    const reason = "Invoice and vendor receipt confirm this payment";
    const result = await store.manualMatchDebit({
      fundId,
      bankTransactionId,
      expenseId: expense.expenseId,
      reason,
      actorPseudonym: `psn_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
    });
    expect(result.kind).toBe("updated");
    const rows = await sql<
      { status: string }[]
    >`SELECT status FROM konto_holds WHERE id = ${expense.holdId}`;
    expect(rows[0]?.status).toBe("COMMITTED");
    const bankRows = await sql<{ reconciliation_status: string }[]>`
      SELECT reconciliation_status FROM bank_transactions WHERE id = ${bankTransactionId}
    `;
    expect(bankRows[0]?.reconciliation_status).toBe("manually_matched");
    expect(await store.listDebitReview(fundId)).toEqual([]);
    const actions = await sql<{ action: string; reason: string }[]>`
      SELECT action, reason FROM debit_reconciliation_actions WHERE bank_transaction_id = ${bankTransactionId}
    `;
    expect(actions).toEqual([{ action: "manual_match", reason }]);
  });
});
