import {
  commitHoldInTx,
  hold,
  KontoDuplicateTransactionError,
  rollbackHoldInTx,
  transferInTx,
} from "@konto-ledger/core";
import type { KontoQueryExecutor, KontoTransactionExecutor } from "@konto-ledger/types";
import { uuidv7 } from "@yen/db";
import type { Event, PseudonymId } from "@yen/eventlog";
import type { Paise } from "@yen/shared";
import { ensureFundAccounts, getFundAccountIds } from "./accounts.js";
import {
  acquireFundLockInTx,
  appendFundEventInTx,
  getFundEvents,
  nowUtcIso,
  parseFundEventRow,
  toEventInput,
} from "./eventlog.js";
import type { FundBalances } from "./replay.js";

export const SYSTEM_ACTOR: PseudonymId = "psn_00000000-0000-7000-8000-000000000000" as PseudonymId;

/**
 * Asserts that the provided executor is an active database transaction handle
 * rather than an unpooled/pooled query executor. Prevents hold operations from
 * auto-committing on a separate connection outside the caller's transaction.
 */
export function assertTransactionExecutor(tx: KontoTransactionExecutor): void {
  if (!tx || typeof tx !== "function") {
    throw new TypeError("Expected a KontoTransactionExecutor function");
  }
  const cast = tx as unknown as Record<string, unknown>;
  if (typeof cast.begin === "function" && typeof cast.savepoint !== "function") {
    throw new TypeError(
      "Expected a transaction handle (KontoTransactionExecutor), but received a query executor / pool with begin(). All ledger operations must run inside an existing database transaction.",
    );
  }
}

async function withTransactionSavepoint<T>(
  tx: KontoTransactionExecutor,
  operation: () => Promise<T>,
): Promise<T> {
  const name = `yen_ledger_${uuidv7().replaceAll("-", "")}`;
  await tx.unsafe(`SAVEPOINT ${name}`);
  try {
    const result = await operation();
    await tx.unsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await tx.unsafe(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

/**
 * Wraps a transaction executor so that Konto operations requiring a KontoQueryExecutor
 * (like hold()) execute within the caller's existing transaction without spawning a new one.
 */
export function asTransactionQueryExecutor(executor: KontoTransactionExecutor): KontoQueryExecutor {
  assertTransactionExecutor(executor);
  const wrapped = (strings: TemplateStringsArray, ...values: unknown[]) =>
    executor(strings, ...values);
  return Object.assign(wrapped, {
    unsafe: (query: string, parameters?: unknown[]) => executor.unsafe(query, parameters),
    json: (value: unknown) => executor.json(value),
    begin: async <T>(cb: (tx: KontoTransactionExecutor) => Promise<T>): Promise<T> => cb(executor),
  }) as KontoQueryExecutor;
}

export const asQueryExecutor = asTransactionQueryExecutor;

export interface RecordDonationInput {
  fundId: string;
  amount: Paise;
  donorId?: string;
  reference?: string;
  bankTransactionId?: string;
  donationId?: string;
  actorPseudonym?: PseudonymId | string;
  idempotencyKey?: string;
  occurredAt?: string;
}

export interface RecordDonationResult {
  journalId: string;
  pledgeEvent: Event;
  verifiedEvent: Event;
  duplicate?: boolean;
}

interface FundEventRow {
  fund_id: string;
  seq: string | number;
  version: number;
  type: string;
  actor: string;
  occurred_at: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}

export async function recordDonation(
  tx: KontoTransactionExecutor,
  input: RecordDonationInput,
): Promise<RecordDonationResult> {
  assertTransactionExecutor(tx);

  if (typeof input.amount !== "number" || !Number.isSafeInteger(input.amount)) {
    throw new TypeError("Paise must be a safe integer");
  }
  if (input.amount <= 0) {
    throw new RangeError("Donation amount must be positive paise");
  }
  const amountBig = BigInt(input.amount);

  // Lock order: acquire fund advisory lock first before Konto row locks
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = await ensureFundAccounts(tx, input.fundId);
  const donationId = input.donationId ?? uuidv7();
  const bankTransactionId = input.bankTransactionId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
  const idempotencyKey =
    input.idempotencyKey ?? (input.reference ? `donation:${input.reference}` : undefined);

  if (idempotencyKey) {
    const existing = await tx<
      {
        id: string;
        metadata: {
          fundId?: string;
          donationId?: string;
          amount?: number;
        } | null;
      }[]
    >`
      SELECT id, metadata FROM konto_journals
      WHERE account_id = ${accounts.bankId} AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (existing[0]) {
      const origDonationId = existing[0].metadata?.donationId ?? input.donationId;
      const existingFundId = existing[0].metadata?.fundId;
      if (existingFundId && existingFundId !== input.fundId) {
        throw new Error(
          `Idempotency conflict: donation already recorded for a different fund: ${existingFundId}`,
        );
      }

      // Query pledge event for the original donation to check amount
      const pledgeRows = await tx<FundEventRow[]>`
        SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
        FROM fund_events
        WHERE fund_id = ${input.fundId}
          AND type = 'donation.pledged'
          AND (payload->>'donation_id') = ${origDonationId}
        LIMIT 1
      `;
      const pledgeRow = pledgeRows[0];
      if (pledgeRow) {
        const recordedAmount = (pledgeRow.payload as { amount_paise: number }).amount_paise;
        if (recordedAmount !== input.amount) {
          throw new Error(
            `Idempotency conflict: donation already recorded with amount ${recordedAmount} paise, got ${input.amount} paise`,
          );
        }

        const verifiedRows = await tx<FundEventRow[]>`
          SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
          FROM fund_events
          WHERE fund_id = ${input.fundId}
            AND type = 'donation.verified'
            AND (payload->>'donation_id') = ${origDonationId}
          LIMIT 1
        `;
        const verifiedRow = verifiedRows[0];
        if (verifiedRow) {
          return {
            journalId: existing[0].id,
            pledgeEvent: parseFundEventRow(pledgeRow),
            verifiedEvent: parseFundEventRow(verifiedRow),
            duplicate: true,
          };
        }
      }
    }
  }

  let journalId: string;
  try {
    const res = await transferInTx(tx, {
      accountId: accounts.bankId,
      idempotencyKey,
      entries: [
        { accountId: accounts.bankId, amount: amountBig },
        { accountId: accounts.donationsId, amount: -amountBig },
      ],
      metadata: {
        fundId: input.fundId,
        reference: input.reference ?? null,
        donorId: input.donorId ?? null,
        donationId,
        amount: input.amount,
      },
    });
    journalId = res.journalId;
  } catch (err) {
    if (err instanceof KontoDuplicateTransactionError && idempotencyKey) {
      const existing = await tx<
        {
          id: string;
          metadata: {
            fundId?: string;
            donationId?: string;
            amount?: number;
          } | null;
        }[]
      >`
        SELECT id, metadata FROM konto_journals
        WHERE account_id = ${accounts.bankId} AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) {
        const origDonationId = existing[0].metadata?.donationId ?? input.donationId;
        const existingFundId = existing[0].metadata?.fundId;
        if (existingFundId && existingFundId !== input.fundId) {
          throw new Error(
            `Idempotency conflict: donation already recorded for a different fund: ${existingFundId}`,
          );
        }

        const pledgeRows = await tx<FundEventRow[]>`
          SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
          FROM fund_events
          WHERE fund_id = ${input.fundId}
            AND type = 'donation.pledged'
            AND (payload->>'donation_id') = ${origDonationId}
          LIMIT 1
        `;
        const pledgeRow = pledgeRows[0];
        if (pledgeRow) {
          const recordedAmount = (pledgeRow.payload as { amount_paise: number }).amount_paise;
          if (recordedAmount !== input.amount) {
            throw new Error(
              `Idempotency conflict: donation already recorded with amount ${recordedAmount} paise, got ${input.amount} paise`,
            );
          }

          const verifiedRows = await tx<FundEventRow[]>`
            SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
            FROM fund_events
            WHERE fund_id = ${input.fundId}
              AND type = 'donation.verified'
              AND (payload->>'donation_id') = ${origDonationId}
            LIMIT 1
          `;
          const verifiedRow = verifiedRows[0];
          if (verifiedRow) {
            return {
              journalId: existing[0].id,
              pledgeEvent: parseFundEventRow(pledgeRow),
              verifiedEvent: parseFundEventRow(verifiedRow),
              duplicate: true,
            };
          }
        }
      }
    }
    throw err;
  }

  const time1 = input.occurredAt ?? nowUtcIso();
  const pledgeEvent = await appendFundEventInTx(
    tx,
    input.fundId,
    toEventInput({
      fund_id: input.fundId,
      type: "donation.pledged",
      actor,
      occurred_at: time1,
      payload: {
        donation_id: donationId,
        amount_paise: Number(amountBig),
      },
    }),
  );

  const time2 = nowUtcIso(time1);
  const verifiedEvent = await appendFundEventInTx(
    tx,
    input.fundId,
    toEventInput({
      fund_id: input.fundId,
      type: "donation.verified",
      actor,
      occurred_at: time2,
      payload: {
        donation_id: donationId,
        bank_transaction_id: bankTransactionId,
      },
    }),
  );

  return {
    journalId,
    pledgeEvent,
    verifiedEvent,
  };
}

export interface ReserveForExpenseInput {
  fundId: string;
  amount: Paise;
  expenseId?: string;
  approverId?: string;
  description?: string;
  idempotencyKey?: string;
  ttlMs?: number;
  actorPseudonym?: PseudonymId | string;
  occurredAt?: string;
}

export interface ReserveForExpenseResult {
  holdId: string;
  expenseId: string;
  submittedEvent: Event;
  approvedEvent: Event;
  duplicate?: boolean;
}

export async function reserveForExpense(
  tx: KontoTransactionExecutor,
  input: ReserveForExpenseInput,
): Promise<ReserveForExpenseResult> {
  assertTransactionExecutor(tx);

  if (typeof input.amount !== "number" || !Number.isSafeInteger(input.amount)) {
    throw new TypeError("Paise must be a safe integer");
  }
  if (input.amount <= 0) {
    throw new RangeError("Reserve amount must be positive paise");
  }
  const amountBig = BigInt(input.amount);

  // Lock order: acquire fund advisory lock first before Konto row locks
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = await ensureFundAccounts(tx, input.fundId);
  const expenseId = input.expenseId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;

  // Idempotency check for existing hold
  if (input.idempotencyKey) {
    const existingHolds = await tx<
      {
        id: string;
        account_id: string;
        recipient_id: string;
        amount: string;
      }[]
    >`
      SELECT id, account_id, recipient_id, amount
      FROM konto_holds
      WHERE account_id = ${accounts.bankId} AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `;
    const existing = existingHolds[0];
    if (existing) {
      const existingAmount = BigInt(existing.amount);
      if (existingAmount !== amountBig) {
        throw new Error(
          `Idempotency conflict: hold already exists with different parameters for key ${input.idempotencyKey}`,
        );
      }
      let existingExpenseId = input.expenseId;
      if (!existingExpenseId) {
        const events = await getFundEvents(tx, input.fundId);
        const submitted = [...events]
          .reverse()
          .find(
            (e) =>
              e.type === "expense.submitted" &&
              BigInt((e.payload as { amount_paise: number }).amount_paise) === existingAmount,
          );
        existingExpenseId = (submitted?.payload as { expense_id: string } | undefined)?.expense_id;
      }
      if (existingExpenseId) {
        const submittedRows = await tx<FundEventRow[]>`
          SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
          FROM fund_events
          WHERE fund_id = ${input.fundId}
            AND type = 'expense.submitted'
            AND (payload->>'expense_id') = ${existingExpenseId}
          LIMIT 1
        `;
        const approvedRows = await tx<FundEventRow[]>`
          SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
          FROM fund_events
          WHERE fund_id = ${input.fundId}
            AND type = 'expense.approved'
            AND (payload->>'expense_id') = ${existingExpenseId}
          LIMIT 1
        `;

        if (submittedRows[0] && approvedRows[0]) {
          return {
            holdId: existing.id,
            expenseId: existingExpenseId,
            submittedEvent: parseFundEventRow(submittedRows[0]),
            approvedEvent: parseFundEventRow(approvedRows[0]),
            duplicate: true,
          };
        }
      }
    }
  }

  try {
    return await withTransactionSavepoint(tx, async () => {
      const holdRes = await hold(asTransactionQueryExecutor(tx), {
        accountId: accounts.bankId,
        recipientId: accounts.expensesId,
        amount: amountBig,
        idempotencyKey: input.idempotencyKey,
        ttlMs: input.ttlMs,
        metadata: {
          fundId: input.fundId,
          expenseId,
          description: input.description ?? "",
          approverId: input.approverId ?? null,
        },
      });
      const holdId = holdRes.holdId;

      const time1 = input.occurredAt ?? nowUtcIso();
      const submittedEvent = await appendFundEventInTx(
        tx,
        input.fundId,
        toEventInput({
          fund_id: input.fundId,
          type: "expense.submitted",
          actor,
          occurred_at: time1,
          payload: {
            expense_id: expenseId,
            amount_paise: Number(amountBig),
          },
        }),
      );

      const time2 = nowUtcIso(time1);
      const approvedEvent = await appendFundEventInTx(
        tx,
        input.fundId,
        toEventInput({
          fund_id: input.fundId,
          type: "expense.approved",
          actor,
          occurred_at: time2,
          payload: {
            expense_id: expenseId,
          },
        }),
      );

      return {
        holdId,
        expenseId,
        submittedEvent,
        approvedEvent,
      };
    });
  } catch (err) {
    if (err instanceof KontoDuplicateTransactionError && input.idempotencyKey) {
      const existingHolds = await tx<
        {
          id: string;
          account_id: string;
          recipient_id: string;
          amount: string;
        }[]
      >`
        SELECT id, account_id, recipient_id, amount
        FROM konto_holds
        WHERE account_id = ${accounts.bankId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      const existing = existingHolds[0];
      if (existing) {
        const existingAmount = BigInt(existing.amount);
        if (existingAmount !== amountBig) {
          throw new Error(
            `Idempotency conflict: hold already exists with different parameters for key ${input.idempotencyKey}`,
          );
        }
        let existingExpenseId = input.expenseId;
        if (!existingExpenseId) {
          const events = await getFundEvents(tx, input.fundId);
          const submitted = [...events]
            .reverse()
            .find(
              (e) =>
                e.type === "expense.submitted" &&
                BigInt((e.payload as { amount_paise: number }).amount_paise) === existingAmount,
            );
          existingExpenseId = (submitted?.payload as { expense_id: string } | undefined)
            ?.expense_id;
        }
        if (existingExpenseId) {
          const submittedRows = await tx<FundEventRow[]>`
            SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
            FROM fund_events
            WHERE fund_id = ${input.fundId}
              AND type = 'expense.submitted'
              AND (payload->>'expense_id') = ${existingExpenseId}
            LIMIT 1
          `;
          const approvedRows = await tx<FundEventRow[]>`
            SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
            FROM fund_events
            WHERE fund_id = ${input.fundId}
              AND type = 'expense.approved'
              AND (payload->>'expense_id') = ${existingExpenseId}
            LIMIT 1
          `;

          if (submittedRows[0] && approvedRows[0]) {
            return {
              holdId: existing.id,
              expenseId: existingExpenseId,
              submittedEvent: parseFundEventRow(submittedRows[0]),
              approvedEvent: parseFundEventRow(approvedRows[0]),
              duplicate: true,
            };
          }
        }
      }
    }
    throw err;
  }
}

export interface SettleExpenseInput {
  fundId: string;
  holdId: string;
  expenseId: string;
  receiptRef?: string;
  bankTransactionId?: string;
  actorPseudonym?: PseudonymId | string;
  occurredAt?: string;
}

export interface SettleExpenseResult {
  journalId: string;
  paidEvent: Event;
}

export async function settleExpense(
  tx: KontoTransactionExecutor,
  input: SettleExpenseInput,
): Promise<SettleExpenseResult> {
  assertTransactionExecutor(tx);
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = getFundAccountIds(input.fundId);
  const holds = await tx<
    {
      id: string;
      account_id: string;
      recipient_id: string;
    }[]
  >`
    SELECT id, account_id, recipient_id
    FROM konto_holds
    WHERE id = ${input.holdId}
    LIMIT 1
  `;
  const holdRow = holds[0];
  if (!holdRow) {
    throw new Error(`Hold ${input.holdId} not found`);
  }
  if (holdRow.account_id !== accounts.bankId || holdRow.recipient_id !== accounts.expensesId) {
    throw new Error(`Hold ${input.holdId} does not belong to fund ${input.fundId}`);
  }

  // Direct targeted query by expense_id instead of loading all fund events
  const expenseRows = await tx<{ type: string; payload: unknown }[]>`
    SELECT type, payload FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND (payload->>'expense_id') = ${input.expenseId}
      AND type IN ('expense.submitted', 'expense.approved')
    LIMIT 1
  `;
  if (!expenseRows[0]) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const bankTransactionId = input.bankTransactionId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;

  const { journalId, paidEvent } = await withTransactionSavepoint(tx, async () => {
    const { journalId } = await commitHoldInTx(tx, input.holdId, {
      fundId: input.fundId,
      expenseId: input.expenseId,
      receiptRef: input.receiptRef ?? null,
    });

    const time = input.occurredAt ?? nowUtcIso();
    const paidEvent = await appendFundEventInTx(
      tx,
      input.fundId,
      toEventInput({
        fund_id: input.fundId,
        type: "expense.paid",
        actor,
        occurred_at: time,
        payload: {
          expense_id: input.expenseId,
          bank_transaction_id: bankTransactionId,
        },
      }),
    );
    return { journalId, paidEvent };
  });

  return {
    journalId,
    paidEvent,
  };
}

export interface ReleaseExpenseInput {
  fundId: string;
  holdId: string;
  expenseId: string;
  reason?: "quorum" | "objection" | "policy";
  actorPseudonym?: PseudonymId | string;
  occurredAt?: string;
}

export interface ReleaseExpenseResult {
  success: boolean;
  rejectedEvent: Event;
}

export async function releaseExpense(
  tx: KontoTransactionExecutor,
  input: ReleaseExpenseInput,
): Promise<ReleaseExpenseResult> {
  assertTransactionExecutor(tx);
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = getFundAccountIds(input.fundId);
  const holds = await tx<
    {
      id: string;
      account_id: string;
      recipient_id: string;
    }[]
  >`
    SELECT id, account_id, recipient_id
    FROM konto_holds
    WHERE id = ${input.holdId}
    LIMIT 1
  `;
  const holdRow = holds[0];
  if (!holdRow) {
    throw new Error(`Hold ${input.holdId} not found`);
  }
  if (holdRow.account_id !== accounts.bankId || holdRow.recipient_id !== accounts.expensesId) {
    throw new Error(`Hold ${input.holdId} does not belong to fund ${input.fundId}`);
  }

  // Direct targeted query by expense_id
  const expenseRows = await tx<{ type: string; payload: unknown }[]>`
    SELECT type, payload FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND (payload->>'expense_id') = ${input.expenseId}
      AND type IN ('expense.submitted', 'expense.approved')
    LIMIT 1
  `;
  if (!expenseRows[0]) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
  const { res, rejectedEvent } = await withTransactionSavepoint(tx, async () => {
    const res = await rollbackHoldInTx(tx, input.holdId);

    const time = input.occurredAt ?? nowUtcIso();
    const rejectedEvent = await appendFundEventInTx(
      tx,
      input.fundId,
      toEventInput({
        fund_id: input.fundId,
        type: "expense.rejected",
        actor,
        occurred_at: time,
        payload: {
          expense_id: input.expenseId,
          reason: input.reason ?? "policy",
        },
      }),
    );
    return { res, rejectedEvent };
  });

  return {
    success: res.success,
    rejectedEvent,
  };
}

export interface ExpireExpenseInput {
  fundId: string;
  holdId: string;
  expenseId: string;
  actorPseudonym?: PseudonymId | string;
  occurredAt?: string;
}

export interface ExpireExpenseResult {
  success: boolean;
  expiredEvent: Event;
}

export async function expireExpense(
  tx: KontoTransactionExecutor,
  input: ExpireExpenseInput,
): Promise<ExpireExpenseResult> {
  assertTransactionExecutor(tx);
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = getFundAccountIds(input.fundId);
  const holds = await tx<
    {
      id: string;
      account_id: string;
      recipient_id: string;
    }[]
  >`
    SELECT id, account_id, recipient_id
    FROM konto_holds
    WHERE id = ${input.holdId}
    LIMIT 1
  `;
  const holdRow = holds[0];
  if (!holdRow) {
    throw new Error(`Hold ${input.holdId} not found`);
  }
  if (holdRow.account_id !== accounts.bankId || holdRow.recipient_id !== accounts.expensesId) {
    throw new Error(`Hold ${input.holdId} does not belong to fund ${input.fundId}`);
  }

  // Direct targeted query by expense_id
  const expenseRows = await tx<{ type: string; payload: unknown }[]>`
    SELECT type, payload FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND (payload->>'expense_id') = ${input.expenseId}
      AND type IN ('expense.submitted', 'expense.approved')
    LIMIT 1
  `;
  if (!expenseRows[0]) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
  const { res, expiredEvent } = await withTransactionSavepoint(tx, async () => {
    const res = await rollbackHoldInTx(tx, input.holdId);

    const time = input.occurredAt ?? nowUtcIso();
    const expiredEvent = await appendFundEventInTx(
      tx,
      input.fundId,
      toEventInput({
        fund_id: input.fundId,
        type: "expense.expired",
        actor,
        occurred_at: time,
        payload: {
          expense_id: input.expenseId,
        },
      }),
    );
    return { res, expiredEvent };
  });

  return {
    success: res.success,
    expiredEvent,
  };
}

export interface RecordRefundInput {
  fundId: string;
  amount?: Paise;
  donationId: string;
  reason?: "unmatched" | "duplicate" | "cancelled";
  actorPseudonym?: PseudonymId | string;
  idempotencyKey?: string;
  occurredAt?: string;
}

export interface RecordRefundResult {
  journalId: string;
  rejectedEvent: Event;
  duplicate?: boolean;
}

export async function recordRefund(
  tx: KontoTransactionExecutor,
  input: RecordRefundInput,
): Promise<RecordRefundResult> {
  assertTransactionExecutor(tx);
  await acquireFundLockInTx(tx, input.fundId);

  const accounts = await ensureFundAccounts(tx, input.fundId);
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
  const idempotencyKey = input.idempotencyKey ?? uuidv7();

  // Find verified donation amount via targeted query
  const pledgeRows = await tx<FundEventRow[]>`
    SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND type = 'donation.pledged'
      AND (payload->>'donation_id') = ${input.donationId}
    LIMIT 1
  `;
  const pledge = pledgeRows[0];
  if (!pledge) {
    throw new Error(`Donation ${input.donationId} not found`);
  }

  // Ensure donation was verified
  const verifiedRows = await tx<{ type: string }[]>`
    SELECT type FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND type = 'donation.verified'
      AND (payload->>'donation_id') = ${input.donationId}
    LIMIT 1
  `;
  if (!verifiedRows[0]) {
    throw new Error(`Donation ${input.donationId} was not verified`);
  }

  // Prevent double refunding: check for previous donation.rejected
  const rejectedRows = await tx<FundEventRow[]>`
    SELECT fund_id, seq, version, type, actor, occurred_at, payload, prev_hash, hash
    FROM fund_events
    WHERE fund_id = ${input.fundId}
      AND type = 'donation.rejected'
      AND (payload->>'donation_id') = ${input.donationId}
    LIMIT 1
  `;
  if (rejectedRows[0]) {
    // Check if idempotent retry ONLY when idempotencyKey was explicitly provided
    if (input.idempotencyKey) {
      const existingRefundJournal = await tx<{ id: string }[]>`
        SELECT id FROM konto_journals
        WHERE account_id = ${accounts.bankId} AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existingRefundJournal[0]) {
        return {
          journalId: existingRefundJournal[0].id,
          rejectedEvent: parseFundEventRow(rejectedRows[0]),
          duplicate: true,
        };
      }
    }
    throw new Error(`Donation ${input.donationId} has already been refunded`);
  }

  const donationAmount = (pledge.payload as { amount_paise: number }).amount_paise;
  if (input.amount !== undefined) {
    if (typeof input.amount !== "number" || !Number.isSafeInteger(input.amount)) {
      throw new TypeError("Paise must be a safe integer");
    }
    if (input.amount !== donationAmount) {
      throw new RangeError(
        `Partial refunds are not supported by the v1 event log contract. Expected full refund of ${donationAmount} paise.`,
      );
    }
  }
  const amountBig = BigInt(donationAmount);

  const { journalId } = await transferInTx(tx, {
    accountId: accounts.bankId,
    idempotencyKey,
    entries: [
      { accountId: accounts.bankId, amount: -amountBig },
      { accountId: accounts.donationsId, amount: amountBig },
    ],
    metadata: {
      fundId: input.fundId,
      refundReason: input.reason ?? "cancelled",
      donationId: input.donationId,
    },
  });

  const time = input.occurredAt ?? nowUtcIso();
  const rejectedEvent = await appendFundEventInTx(
    tx,
    input.fundId,
    toEventInput({
      fund_id: input.fundId,
      type: "donation.rejected",
      actor,
      occurred_at: time,
      payload: {
        donation_id: input.donationId,
        reason: input.reason ?? "cancelled",
      },
    }),
  );

  return {
    journalId,
    rejectedEvent,
  };
}

export async function getBalances(
  sql: KontoTransactionExecutor,
  fundId: string,
): Promise<FundBalances> {
  const accounts = getFundAccountIds(fundId);

  const rows = await sql<
    {
      account_id: string;
      entries_sum: string;
      holds_sum: string;
    }[]
  >`
    SELECT
      a.id AS account_id,
      COALESCE(e.entries_sum, 0)::text AS entries_sum,
      COALESCE(h.holds_sum, 0)::text AS holds_sum
    FROM (
      SELECT ${accounts.bankId}::uuid AS id
      UNION ALL SELECT ${accounts.donationsId}::uuid
      UNION ALL SELECT ${accounts.expensesId}::uuid
      UNION ALL SELECT ${accounts.pendingSpendId}::uuid
    ) a
    LEFT JOIN (
      SELECT account_id, SUM(amount) AS entries_sum
      FROM konto_entries
      GROUP BY account_id
    ) e ON e.account_id = a.id
    LEFT JOIN (
      SELECT account_id, SUM(amount) AS holds_sum
      FROM konto_holds
      WHERE status = 'PENDING'
      GROUP BY account_id
    ) h ON h.account_id = a.id
  `;

  const byId = new Map(
    rows.map((r) => [r.account_id, { entries: BigInt(r.entries_sum), holds: BigInt(r.holds_sum) }]),
  );

  const bank = byId.get(accounts.bankId)?.entries ?? 0n;
  const pendingSpend = byId.get(accounts.bankId)?.holds ?? 0n;
  const donations = -(byId.get(accounts.donationsId)?.entries ?? 0n);
  const expenses = byId.get(accounts.expensesId)?.entries ?? 0n;
  const availablePaise = bank - pendingSpend;

  return {
    fundId,
    bankPaise: bank,
    pendingSpendPaise: pendingSpend,
    availablePaise,
    donationsPaise: donations >= 0n ? donations : 0n,
    expensesPaise: expenses >= 0n ? expenses : 0n,
  };
}

export async function balance(sql: KontoTransactionExecutor, fundId: string): Promise<bigint> {
  const balances = await getBalances(sql, fundId);
  return balances.bankPaise;
}

export async function available(sql: KontoTransactionExecutor, fundId: string): Promise<bigint> {
  const balances = await getBalances(sql, fundId);
  return balances.availablePaise;
}
