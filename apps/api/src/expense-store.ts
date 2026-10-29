import { randomUUID } from "node:crypto";
import { ensureFundPseudonym, type Sql, type TransactionSql } from "@yen/db";
import type { PseudonymId } from "@yen/eventlog";
import {
  approveExpenseInTx,
  assertAcknowledgementsUnchanged,
  ExpenseNotFoundError,
  type ExpenseRequest,
  type ExpenseStore,
  type FundPolicy,
  InvalidStateTransitionError,
  payExpenseInTx,
  reconcileExpenseInTx,
  rejectExpenseInTx,
  type SignedApproval,
  submitExpenseInTx,
} from "@yen/ledger";
import type { FraudPolicy } from "@yen/policy";

type ExpenseRow = { expense_data: ExpenseRequest | string };

function decode(row: ExpenseRow | undefined): ExpenseRequest | null {
  if (!row) return null;
  const expense =
    typeof row.expense_data === "string"
      ? (JSON.parse(row.expense_data) as ExpenseRequest)
      : row.expense_data;
  return {
    ...expense,
    payee: expense.payee ?? null,
    payeeFingerprint: expense.payeeFingerprint ?? null,
    lastPayeeChangedAt: expense.lastPayeeChangedAt ?? null,
    fraudEvaluationId: expense.fraudEvaluationId ?? null,
    fraudFlags: expense.fraudFlags ?? [],
    fraudAcknowledgements: expense.fraudAcknowledgements ?? [],
  };
}

async function persist(tx: TransactionSql, expense: ExpenseRequest): Promise<void> {
  await tx`
    INSERT INTO expenses (id, fund_id, status, hold_id, expense_data, created_at, updated_at)
    VALUES (${expense.id}, ${expense.fundId}, ${expense.status}, ${expense.holdId},
      ${tx.json(expense as unknown as Record<string, string>)}, ${expense.createdAt}, ${expense.updatedAt})
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      hold_id = EXCLUDED.hold_id,
      expense_data = EXCLUDED.expense_data,
      updated_at = EXCLUDED.updated_at
  `;
  for (const approval of expense.approvals) {
    await tx`
      INSERT INTO expense_approvals (
        expense_id, approver_id, approved_at, approval_data,
        device_signature_present, credential_id_hash
      )
      VALUES (
        ${expense.id}, ${approval.approverId}, ${approval.approvedAt}, ${JSON.stringify(approval)}::jsonb,
        ${approval.deviceSignaturePresent ?? false}, ${approval.credentialIdHash ?? null}
      )
      ON CONFLICT (expense_id, approver_id) DO NOTHING
    `;
  }
  if (expense.fraudEvaluationId && expense.payeeFingerprint) {
    await tx`
      INSERT INTO expense_payee_evaluations (evaluation_id, expense_id, fund_id, payee_fingerprint, evaluated_at)
      VALUES (${expense.fraudEvaluationId}, ${expense.id}, ${expense.fundId}, ${expense.payeeFingerprint}, ${expense.updatedAt})
      ON CONFLICT (evaluation_id) DO NOTHING
    `;
    for (const flag of expense.fraudFlags) {
      await tx`
        INSERT INTO expense_payee_flags (evaluation_id, fund_id, expense_id, code, reason)
        VALUES (${expense.fraudEvaluationId}, ${expense.fundId}, ${expense.id}, ${flag.code}, ${flag.reason})
        ON CONFLICT (evaluation_id, code) DO NOTHING
      `;
    }
    for (const acknowledgement of expense.fraudAcknowledgements) {
      await tx`
        INSERT INTO expense_payee_acknowledgements (
          acknowledgement_id, evaluation_id, fund_id, expense_id, code,
          actor_pseudonym_id, reason, acknowledged_at
        ) VALUES (
          ${randomUUID()}, ${expense.fraudEvaluationId}, ${expense.fundId}, ${expense.id},
          ${acknowledgement.code}, ${acknowledgement.actorPseudonym.slice("psn_".length)},
          ${acknowledgement.reason}, ${acknowledgement.acknowledgedAt}
        ) ON CONFLICT (evaluation_id, code) DO NOTHING
      `;
    }
  }
}

const DEFAULT_EXPENSE_POLICY: FundPolicy = {
  approvalQuorum: 2,
  objectionWindowHours: 24,
  autoExpireHours: 72,
};

/** Persists an expense transition together with its ledger postings and canonical event. */
export class PostgresExpenseStore implements ExpenseStore {
  constructor(private readonly sql: Sql) {}

  async get(expenseId: string): Promise<ExpenseRequest | null> {
    const rows = await this.sql<ExpenseRow[]>`
      SELECT expense_data FROM expenses WHERE id = ${expenseId}
    `;
    return decode(rows[0]);
  }

  async list(fundId: string): Promise<ExpenseRequest[]> {
    const rows = await this.sql<ExpenseRow[]>`
      SELECT expense_data FROM expenses
      WHERE fund_id = ${fundId}
      ORDER BY created_at DESC, id DESC
    `;
    return rows.map((row) => decode(row)).filter((row): row is ExpenseRequest => row !== null);
  }

  async save(
    expense: ExpenseRequest,
    context: {
      readonly actorId?: PseudonymId;
      readonly actorUserId?: string;
      readonly policy?: FundPolicy;
    } = {},
  ): Promise<ExpenseRequest> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ExpenseRow[]>`
        SELECT expense_data FROM expenses WHERE id = ${expense.id} FOR UPDATE
      `;
      const current = decode(rows[0]);
      assertAcknowledgementsUnchanged(current ?? undefined, expense);
      if (!current) {
        if (expense.status !== "draft") throw new ExpenseNotFoundError(expense.id);
        await persist(tx, expense);
        return expense;
      }

      const policy = context.policy ?? DEFAULT_EXPENSE_POLICY;
      const actorId = context.actorUserId
        ? await ensureFundPseudonym(tx, { userId: context.actorUserId, fundId: expense.fundId })
        : context.actorId;
      let updated = expense;
      if (current.status === "draft" && expense.status === "submitted") {
        const submitted = {
          ...current,
          payee: expense.payee,
          payeeFingerprint: expense.payeeFingerprint,
          lastPayeeChangedAt: expense.lastPayeeChangedAt,
          fraudEvaluationId: expense.fraudEvaluationId,
          fraudFlags: expense.fraudFlags,
          fraudAcknowledgements: expense.fraudAcknowledgements,
          ...(expense.invoiceNumber ? { invoiceNumber: expense.invoiceNumber } : {}),
        };
        const result = await submitExpenseInTx({
          tx,
          expense: submitted,
          policy,
          actorPseudonym: actorId ?? expense.requesterId,
          idempotencyKey: `expense:${expense.id}:hold`,
          ...(expense.submittedAt ? { nowUtc: expense.submittedAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "submitted" && expense.status === "rejected") {
        const result = await rejectExpenseInTx({
          tx,
          expense: current,
          reason: expense.rejectionReason ?? "policy",
          ...(actorId ? { actorPseudonym: actorId } : {}),
          ...(expense.rejectedAt ? { nowUtc: expense.rejectedAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "approved" && expense.status === "paid") {
        const transactionId = expense.bankTransactionId;
        if (!transactionId) throw new Error("Paid expense is missing its bank transaction ID");
        const linked = await tx<{ id: string }[]>`
          UPDATE bank_transactions SET matched_expense_id = ${expense.id}, reconciliation_status = 'matched'
          WHERE id = ${transactionId} AND fund_id = ${expense.fundId} AND type = 'debit'
            AND amount_paise = ${expense.amountPaise} AND reconciliation_status = 'unmatched'
            AND matched_expense_id IS NULL
          RETURNING id
        `;
        if (!linked[0])
          throw new Error("Bank transaction is not an unmatched ingested debit for this expense");
        const result = await payExpenseInTx({
          tx,
          expense: current,
          bankTransactionId: transactionId,
          ...(actorId ? { actorPseudonym: actorId } : {}),
          ...(expense.paidAt ? { nowUtc: expense.paidAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "paid" && expense.status === "reconciled") {
        const transactionId = expense.bankTransactionId;
        if (!transactionId)
          throw new Error("Reconciled expense is missing its bank transaction ID");
        const linked = await tx<{ id: string }[]>`
          SELECT id FROM bank_transactions
          WHERE id = ${transactionId} AND fund_id = ${expense.fundId} AND type = 'debit'
            AND amount_paise = ${expense.amountPaise} AND matched_expense_id = ${expense.id}
        `;
        if (!linked[0]) throw new Error("Bank transaction is not linked to this expense");
        const result = await reconcileExpenseInTx({
          tx,
          expense: current,
          bankTransactionId: transactionId,
          ...(actorId ? { actorPseudonym: actorId } : {}),
          ...(expense.reconciledAt ? { nowUtc: expense.reconciledAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status !== expense.status) {
        throw new InvalidStateTransitionError(current.status, expense.status);
      }
      await persist(tx, updated);
      return updated;
    });
  }

  async atomicApprove(
    expenseId: string,
    approval: SignedApproval,
    policy: FundPolicy,
    verifyApprovalProof: Parameters<ExpenseStore["atomicApprove"]>[3],
    nowUtc?: string,
    actorUserId?: string,
    fraudPolicy?: FraudPolicy,
  ) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ExpenseRow[]>`
        SELECT expense_data FROM expenses WHERE id = ${expenseId} FOR UPDATE
      `;
      const expense = decode(rows[0]);
      if (!expense) throw new ExpenseNotFoundError(expenseId);
      const actorId = actorUserId
        ? await ensureFundPseudonym(tx, { userId: actorUserId, fundId: expense.fundId })
        : approval.approverId;
      const openObjections = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM expense_objections o
        LEFT JOIN expense_objection_resolutions r ON r.objection_id = o.id
        WHERE o.expense_id = ${expenseId} AND r.objection_id IS NULL
      `;
      const result = await approveExpenseInTx({
        tx,
        expense,
        approval: { ...approval, approverId: actorId },
        policy,
        verifyApprovalProof,
        ...(fraudPolicy ? { fraudPolicy } : {}),
        actorPseudonym: actorId,
        hasOpenObjection: (openObjections[0]?.count ?? 0) > 0,
        ...(nowUtc ? { nowUtc } : {}),
      });
      await persist(tx, result.updatedExpense);
      return { expense: result.updatedExpense, reachedQuorum: result.reachedQuorum };
    });
  }
}
