import type { Sql, TransactionSql } from "@yen/db";
import {
  approveExpenseInTx,
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

type ExpenseRow = { expense_data: ExpenseRequest | string };

function decode(row: ExpenseRow | undefined): ExpenseRequest | null {
  if (!row) return null;
  return typeof row.expense_data === "string"
    ? (JSON.parse(row.expense_data) as ExpenseRequest)
    : row.expense_data;
}

async function persist(tx: TransactionSql, expense: ExpenseRequest): Promise<void> {
  await tx`
    INSERT INTO expenses (id, fund_id, status, hold_id, expense_data, created_at, updated_at)
    VALUES (${expense.id}, ${expense.fundId}, ${expense.status}, ${expense.holdId},
      ${JSON.stringify(expense)}::jsonb, ${expense.createdAt}, ${expense.updatedAt})
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      hold_id = EXCLUDED.hold_id,
      expense_data = EXCLUDED.expense_data,
      updated_at = EXCLUDED.updated_at
  `;
  for (const approval of expense.approvals) {
    await tx`
      INSERT INTO expense_approvals (expense_id, approver_id, approved_at, approval_data)
      VALUES (${expense.id}, ${approval.approverId}, ${approval.approvedAt}, ${JSON.stringify(approval)}::jsonb)
      ON CONFLICT (expense_id, approver_id) DO NOTHING
    `;
  }
}

const DEFAULT_EXPENSE_POLICY: FundPolicy = {
  approvalQuorum: 2,
  objectionWindowHours: 0,
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
    context: { readonly actorId?: string; readonly policy?: FundPolicy } = {},
  ): Promise<ExpenseRequest> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ExpenseRow[]>`
        SELECT expense_data FROM expenses WHERE id = ${expense.id} FOR UPDATE
      `;
      const current = decode(rows[0]);
      if (!current) {
        if (expense.status !== "draft") throw new ExpenseNotFoundError(expense.id);
        await persist(tx, expense);
        return expense;
      }

      const policy = context.policy ?? DEFAULT_EXPENSE_POLICY;
      let updated = expense;
      if (current.status === "draft" && expense.status === "submitted") {
        const result = await submitExpenseInTx({
          tx,
          expense: current,
          policy,
          actorPseudonym: context.actorId ?? expense.requesterId,
          idempotencyKey: `expense:${expense.id}:hold`,
          ...(expense.submittedAt ? { nowUtc: expense.submittedAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "submitted" && expense.status === "rejected") {
        const result = await rejectExpenseInTx({
          tx,
          expense: current,
          reason: expense.rejectionReason ?? "policy",
          ...(context.actorId ? { actorPseudonym: context.actorId } : {}),
          ...(expense.rejectedAt ? { nowUtc: expense.rejectedAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "approved" && expense.status === "paid") {
        const transactionId = expense.bankTransactionId;
        if (!transactionId) throw new Error("Paid expense is missing its bank transaction ID");
        const result = await payExpenseInTx({
          tx,
          expense: current,
          bankTransactionId: transactionId,
          ...(context.actorId ? { actorPseudonym: context.actorId } : {}),
          ...(expense.paidAt ? { nowUtc: expense.paidAt } : {}),
        });
        updated = result.updatedExpense;
      } else if (current.status === "paid" && expense.status === "reconciled") {
        const transactionId = expense.bankTransactionId;
        if (!transactionId)
          throw new Error("Reconciled expense is missing its bank transaction ID");
        const result = await reconcileExpenseInTx({
          tx,
          expense: current,
          bankTransactionId: transactionId,
          ...(context.actorId ? { actorPseudonym: context.actorId } : {}),
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
  ) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ExpenseRow[]>`
        SELECT expense_data FROM expenses WHERE id = ${expenseId} FOR UPDATE
      `;
      const expense = decode(rows[0]);
      if (!expense) throw new ExpenseNotFoundError(expenseId);
      const result = await approveExpenseInTx({
        tx,
        expense,
        approval,
        policy,
        verifyApprovalProof,
        actorPseudonym: approval.approverId,
        ...(nowUtc ? { nowUtc } : {}),
      });
      await persist(tx, result.updatedExpense);
      return { expense: result.updatedExpense, reachedQuorum: result.reachedQuorum };
    });
  }
}
