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
import { type Paise, paise } from "@yen/shared";
import { ensureFundAccounts, getFundAccountIds } from "./accounts.js";
import { appendFundEventInTx, getFundEvents, nowUtcIso, toEventInput } from "./eventlog.js";
import type { FundBalances } from "./replay.js";

export const SYSTEM_ACTOR: PseudonymId = "psn_00000000-0000-7000-8000-000000000000" as PseudonymId;

export function asQueryExecutor(
  executor: KontoTransactionExecutor | KontoQueryExecutor,
): KontoQueryExecutor {
  const cast = executor as unknown as Record<string, unknown>;
  if (typeof cast.begin === "function") {
    return executor as KontoQueryExecutor;
  }
  const wrapped = (strings: TemplateStringsArray, ...values: unknown[]) =>
    executor(strings, ...values);
  return Object.assign(wrapped, {
    unsafe: (query: string, parameters?: unknown[]) => executor.unsafe(query, parameters),
    json: (value: unknown) => executor.json(value),
    begin: async <T>(cb: (tx: KontoTransactionExecutor) => Promise<T>): Promise<T> => cb(executor),
  }) as KontoQueryExecutor;
}

export interface RecordDonationInput {
  fundId: string;
  amount: Paise | number;
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

export async function recordDonation(
  tx: KontoTransactionExecutor,
  input: RecordDonationInput,
): Promise<RecordDonationResult> {
  const paiseAmount = paise(typeof input.amount === "number" ? input.amount : Number(input.amount));
  if (paiseAmount <= 0) {
    throw new RangeError("Donation amount must be positive paise");
  }
  const amountBig = BigInt(paiseAmount);

  const accounts = await ensureFundAccounts(tx, input.fundId);
  const donationId = input.donationId ?? uuidv7();
  const bankTransactionId = input.bankTransactionId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
  const idempotencyKey =
    input.idempotencyKey ?? (input.reference ? `donation:${input.reference}` : undefined);

  if (idempotencyKey) {
    const existing = await tx<{ id: string; metadata: { donationId?: string } | null }[]>`
      SELECT id, metadata FROM konto_journals
      WHERE account_id = ${accounts.bankId} AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (existing[0]) {
      const origDonationId = existing[0].metadata?.donationId ?? input.donationId;
      const events = await getFundEvents(tx, input.fundId);
      const verified = events.find(
        (e) =>
          e.type === "donation.verified" &&
          (!origDonationId ||
            (e.payload as { donation_id: string }).donation_id === origDonationId),
      );
      const pledge = events.find(
        (e) =>
          e.type === "donation.pledged" &&
          (!origDonationId ||
            (e.payload as { donation_id: string }).donation_id === origDonationId),
      );
      if (verified && pledge) {
        return {
          journalId: existing[0].id,
          pledgeEvent: pledge,
          verifiedEvent: verified,
          duplicate: true,
        };
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
      },
    });
    journalId = res.journalId;
  } catch (err) {
    if (err instanceof KontoDuplicateTransactionError && idempotencyKey) {
      const existing = await tx<{ id: string; metadata: { donationId?: string } | null }[]>`
        SELECT id, metadata FROM konto_journals
        WHERE account_id = ${accounts.bankId} AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) {
        const origDonationId = existing[0].metadata?.donationId ?? input.donationId;
        const events = await getFundEvents(tx, input.fundId);
        const verified = events.find(
          (e) =>
            e.type === "donation.verified" &&
            (!origDonationId ||
              (e.payload as { donation_id: string }).donation_id === origDonationId),
        );
        const pledge = events.find(
          (e) =>
            e.type === "donation.pledged" &&
            (!origDonationId ||
              (e.payload as { donation_id: string }).donation_id === origDonationId),
        );
        if (verified && pledge) {
          return {
            journalId: existing[0].id,
            pledgeEvent: pledge,
            verifiedEvent: verified,
            duplicate: true,
          };
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
  amount: Paise | number;
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
}

export async function reserveForExpense(
  tx: KontoTransactionExecutor,
  input: ReserveForExpenseInput,
): Promise<ReserveForExpenseResult> {
  const paiseAmount = paise(typeof input.amount === "number" ? input.amount : Number(input.amount));
  if (paiseAmount <= 0) {
    throw new RangeError("Reserve amount must be positive paise");
  }
  const amountBig = BigInt(paiseAmount);

  const accounts = await ensureFundAccounts(tx, input.fundId);
  const expenseId = input.expenseId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;

  const { holdId } = await hold(asQueryExecutor(tx), {
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

  const events = await getFundEvents(tx, input.fundId);
  const expenseEvent = events.find(
    (e) =>
      (e.type === "expense.submitted" || e.type === "expense.approved") &&
      (e.payload as { expense_id: string }).expense_id === input.expenseId,
  );
  if (!expenseEvent) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const bankTransactionId = input.bankTransactionId ?? uuidv7();
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;

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

  const events = await getFundEvents(tx, input.fundId);
  const expenseEvent = events.find(
    (e) =>
      (e.type === "expense.submitted" || e.type === "expense.approved") &&
      (e.payload as { expense_id: string }).expense_id === input.expenseId,
  );
  if (!expenseEvent) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
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

  const events = await getFundEvents(tx, input.fundId);
  const expenseEvent = events.find(
    (e) =>
      (e.type === "expense.submitted" || e.type === "expense.approved") &&
      (e.payload as { expense_id: string }).expense_id === input.expenseId,
  );
  if (!expenseEvent) {
    throw new Error(`Expense ${input.expenseId} does not belong to fund ${input.fundId}`);
  }

  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;
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

  return {
    success: res.success,
    expiredEvent,
  };
}

export interface RecordRefundInput {
  fundId: string;
  amount?: Paise | number;
  donationId: string;
  reason?: "unmatched" | "duplicate" | "cancelled";
  actorPseudonym?: PseudonymId | string;
  idempotencyKey?: string;
  occurredAt?: string;
}

export interface RecordRefundResult {
  journalId: string;
  rejectedEvent: Event;
}

export async function recordRefund(
  tx: KontoTransactionExecutor,
  input: RecordRefundInput,
): Promise<RecordRefundResult> {
  const accounts = await ensureFundAccounts(tx, input.fundId);
  const actor = (input.actorPseudonym ?? SYSTEM_ACTOR) as PseudonymId;

  // Find verified donation amount
  const events = await getFundEvents(tx, input.fundId);
  const pledge = events.find(
    (e) =>
      e.type === "donation.pledged" &&
      (e.payload as { donation_id: string }).donation_id === input.donationId,
  );
  if (!pledge) {
    throw new Error(`Donation ${input.donationId} not found`);
  }
  const donationAmount = (pledge.payload as { amount_paise: number }).amount_paise;
  if (input.amount !== undefined) {
    const requested = paise(typeof input.amount === "number" ? input.amount : Number(input.amount));
    if (requested !== donationAmount) {
      throw new RangeError(
        `Partial refunds are not supported by the v1 event log contract. Expected full refund of ${donationAmount} paise.`,
      );
    }
  }
  const amountBig = BigInt(donationAmount);

  const { journalId } = await transferInTx(tx, {
    accountId: accounts.bankId,
    idempotencyKey: input.idempotencyKey,
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
