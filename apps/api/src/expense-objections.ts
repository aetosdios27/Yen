import { ensureFundPseudonym, type Sql, type TransactionSql, uuidv7 } from "@yen/db";
import type { PseudonymId } from "@yen/eventlog";
import {
  appendFundEventInTx,
  type ExpenseRequest,
  evaluateObjectionWindow,
  type FundPolicy,
  rejectExpenseInTx,
  toEventInput,
} from "@yen/ledger";

export type ObjectionResolution = "upheld" | "dismissed";
export interface ExpenseObjection {
  readonly id: string;
  readonly expenseId: string;
  readonly actorId: PseudonymId;
  readonly reason: string;
  readonly createdAt: string;
  readonly resolution: ObjectionResolution | null;
  readonly resolutionReason: string | null;
}

export class ObjectionConflictError extends Error {}
export class ObjectionNotFoundError extends Error {}
export class ObjectionWindowClosedError extends Error {}

function hasPii(value: string): boolean {
  return /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{8,}\d/i.test(value);
}

function decodeExpense(row: { expense_data: ExpenseRequest | string }): ExpenseRequest {
  return typeof row.expense_data === "string"
    ? (JSON.parse(row.expense_data) as ExpenseRequest)
    : row.expense_data;
}

async function saveExpense(tx: TransactionSql, expense: ExpenseRequest) {
  await tx`UPDATE expenses SET status = ${expense.status}, hold_id = ${expense.holdId},
    expense_data = ${JSON.stringify(expense)}::jsonb, updated_at = ${expense.updatedAt} WHERE id = ${expense.id}`;
}

/** Postgres implementation: expense row locks serialize objections, resolutions and approvals. */
export class PostgresExpenseObjectionStore {
  constructor(private readonly sql: Sql) {}

  async raise(input: {
    expenseId: string;
    actorUserId: string;
    reason: string;
    idempotencyKey: string;
    nowUtc: string;
  }) {
    const reason = input.reason.trim();
    if (
      !reason ||
      reason.length > 500 ||
      hasPii(reason) ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.length > 128
    ) {
      throw new TypeError("Invalid objection input");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        { expense_data: ExpenseRequest | string }[]
      >`SELECT expense_data FROM expenses WHERE id = ${input.expenseId} FOR UPDATE`;
      if (!rows[0]) throw new ObjectionNotFoundError();
      const expense = decodeExpense(rows[0]);
      if (expense.status !== "submitted") throw new ObjectionConflictError();
      if (
        !expense.objectionEndsAt ||
        Date.parse(input.nowUtc) >= Date.parse(expense.objectionEndsAt)
      )
        throw new ObjectionWindowClosedError();
      const actorId = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: expense.fundId,
      });
      const existing = await tx<
        { id: string }[]
      >`SELECT id FROM expense_objections WHERE expense_id = ${expense.id} AND actor_id = ${actorId}`;
      if (existing[0]) return { id: existing[0].id, duplicate: true as const };
      const id = uuidv7();
      await tx`INSERT INTO expense_objections (id, expense_id, fund_id, actor_id, reason, idempotency_key, created_at)
        VALUES (${id}, ${expense.id}, ${expense.fundId}, ${actorId}, ${reason}, ${input.idempotencyKey}, ${input.nowUtc})`;
      await appendFundEventInTx(
        tx,
        expense.fundId,
        toEventInput({
          fund_id: expense.fundId,
          type: "expense.objection_raised",
          version: 2,
          actor: actorId,
          occurred_at: input.nowUtc,
          payload: { expense_id: expense.id, objection_id: id },
        }),
      );
      return { id, duplicate: false as const };
    });
  }

  async list(expenseId: string): Promise<ExpenseObjection[]> {
    return this.sql<
      ExpenseObjection[]
    >`SELECT o.id, o.expense_id AS "expenseId", o.actor_id AS "actorId", o.reason, o.created_at AS "createdAt", r.resolution, r.reason AS "resolutionReason"
      FROM expense_objections o LEFT JOIN expense_objection_resolutions r ON r.objection_id = o.id
      WHERE o.expense_id = ${expenseId} ORDER BY o.created_at, o.id`;
  }

  async resolve(input: {
    expenseId: string;
    objectionId: string;
    actorUserId: string;
    resolution: ObjectionResolution;
    reason: string;
    policy: FundPolicy;
    nowUtc: string;
  }) {
    const reason = input.reason.trim();
    if (!reason || reason.length > 500 || hasPii(reason))
      throw new TypeError("Invalid resolution reason");
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        { expense_data: ExpenseRequest | string }[]
      >`SELECT expense_data FROM expenses WHERE id = ${input.expenseId} FOR UPDATE`;
      if (!rows[0]) throw new ObjectionNotFoundError();
      const expense = decodeExpense(rows[0]);
      if (expense.status !== "submitted") throw new ObjectionConflictError();
      const actorId = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: expense.fundId,
      });
      const objection = await tx<
        { id: string }[]
      >`SELECT id FROM expense_objections WHERE id = ${input.objectionId} AND expense_id = ${expense.id}`;
      if (!objection[0]) throw new ObjectionNotFoundError();
      const inserted = await tx<
        { objection_id: string }[]
      >`INSERT INTO expense_objection_resolutions (objection_id, actor_id, resolution, reason, created_at)
        VALUES (${input.objectionId}, ${actorId}, ${input.resolution}, ${reason}, ${input.nowUtc}) ON CONFLICT DO NOTHING RETURNING objection_id`;
      if (!inserted[0]) throw new ObjectionConflictError();
      await appendFundEventInTx(
        tx,
        expense.fundId,
        toEventInput({
          fund_id: expense.fundId,
          type: "expense.objection_resolved",
          actor: actorId,
          occurred_at: input.nowUtc,
          payload: {
            expense_id: expense.id,
            objection_id: input.objectionId,
            resolution: input.resolution,
          },
        }),
      );
      if (input.resolution === "upheld") {
        const rejected = await rejectExpenseInTx({
          tx,
          expense,
          reason: "objection",
          actorPseudonym: actorId,
          nowUtc: input.nowUtc,
        });
        await saveExpense(tx, rejected.updatedExpense);
        return rejected.updatedExpense;
      }
      const remaining = await tx<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM expense_objections o LEFT JOIN expense_objection_resolutions r ON r.objection_id = o.id WHERE o.expense_id = ${expense.id} AND r.objection_id IS NULL`;
      if ((remaining[0]?.count ?? 0) === 0) {
        const result = evaluateObjectionWindow(expense, input.policy, input.nowUtc);
        if (result.transitioned) {
          await appendFundEventInTx(
            tx,
            expense.fundId,
            toEventInput({
              fund_id: expense.fundId,
              type: "expense.approved",
              actor: actorId,
              occurred_at: input.nowUtc,
              payload: { expense_id: expense.id },
            }),
          );
          await saveExpense(tx, result.expense);
          return result.expense;
        }
      }
      return expense;
    });
  }
}
