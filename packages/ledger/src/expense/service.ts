import {
  commitHoldInTx,
  hold,
  KontoInsufficientFundsError,
  rollbackHoldInTx,
} from "@konto-ledger/core";
import type { KontoTransactionExecutor } from "@konto-ledger/types";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { type Event, type PseudonymId, parsePseudonymId } from "@yen/eventlog";
import { paise } from "@yen/shared";
import { ensureFundAccounts } from "../accounts.js";
import { appendFundEventInTx, nowUtcIso, toEventInput } from "../eventlog.js";
import { asQueryExecutor, available } from "../operations.js";
import {
  addSignedApproval,
  assertValidTransition,
  expireExpense,
  payExpense,
  reconcileExpense,
  rejectExpense,
  submitExpense,
} from "./state-machine.js";
import type { ApprovalProofVerifier, ExpenseRequest, FundPolicy, SignedApproval } from "./types.js";

export const SYSTEM_ACTOR: PseudonymId = parsePseudonymId(
  "psn_00000000-0000-7000-8000-000000000000",
);

export interface SubmitExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly policy: FundPolicy;
  readonly actorPseudonym?: PseudonymId;
  readonly idempotencyKey?: string;
  readonly nowUtc?: string;
}

export interface SubmitExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly holdId: string;
  readonly submittedEvent: Event;
}

export async function submitExpenseInTx(
  input: SubmitExpenseInTxInput,
): Promise<SubmitExpenseInTxResult> {
  const { tx, expense, policy } = input;
  assertValidTransition(expense.status, "submitted");
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? expense.requesterId ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();

  // Take advisory lock keyed by fundId to serialize event log appends and state transitions
  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  const accounts = await ensureFundAccounts(tx, fundId);
  const paiseAmount = paise(Number(expense.amountPaise));
  const amountBig = BigInt(paiseAmount);

  // Check available balance before hold
  const avail = await available(tx, fundId);
  if (avail < amountBig) {
    throw new KontoInsufficientFundsError(
      `Insufficient funds for fund ${fundId}: available ${avail} paise, requested ${paiseAmount} paise`,
    );
  }

  // Create Konto hold in the ledger
  const ttlMs = policy.autoExpireHours > 0 ? policy.autoExpireHours * 3600_000 : undefined;
  const holdResult = await hold(asQueryExecutor(tx), {
    accountId: accounts.bankId,
    recipientId: accounts.expensesId,
    amount: amountBig,
    idempotencyKey: input.idempotencyKey,
    ttlMs,
    metadata: {
      fundId,
      expenseId: expense.id,
      description: expense.description,
    },
  });

  // Append matching event in the SAME transaction
  const submittedEvent = await appendFundEventInTx(
    tx,
    fundId,
    toEventInput({
      fund_id: fundId,
      type: "expense.submitted",
      actor,
      occurred_at: time,
      payload: {
        expense_id: expense.id,
        amount_paise: paiseAmount,
      },
    }),
  );

  const updatedExpense = submitExpense(expense, {
    holdId: holdResult.holdId,
    policy,
    nowUtc: time,
  });

  return {
    updatedExpense,
    holdId: holdResult.holdId,
    submittedEvent,
  };
}

export interface ApproveExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly approval: SignedApproval;
  readonly policy: FundPolicy;
  readonly verifyApprovalProof: ApprovalProofVerifier;
  readonly actorPseudonym?: PseudonymId;
  readonly nowUtc?: string;
}

export interface ApproveExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly reachedQuorum: boolean;
  readonly approvedEvent?: Event | undefined;
}

export async function approveExpenseInTx(
  input: ApproveExpenseInTxInput,
): Promise<ApproveExpenseInTxResult> {
  const span = trace.getTracer("yen-ledger").startSpan("ledger.approve");
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      return await approveExpenseInTxInner(input);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

async function approveExpenseInTxInner(
  input: ApproveExpenseInTxInput,
): Promise<ApproveExpenseInTxResult> {
  const { tx, expense, approval, policy } = input;
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? approval.approverId ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();

  const { expense: updatedExpense, reachedQuorum } = addSignedApproval(
    expense,
    approval,
    policy,
    input.verifyApprovalProof,
    time,
  );

  // Advisory lock serializes concurrent approvals
  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  let approvedEvent: Event | undefined;
  if (reachedQuorum) {
    approvedEvent = await appendFundEventInTx(
      tx,
      fundId,
      toEventInput({
        fund_id: fundId,
        type: "expense.approved",
        actor,
        occurred_at: time,
        payload: {
          expense_id: expense.id,
        },
      }),
    );
  }

  return {
    updatedExpense,
    reachedQuorum,
    approvedEvent,
  };
}

export interface RejectExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly reason: "quorum" | "objection" | "policy";
  readonly actorPseudonym?: PseudonymId;
  readonly nowUtc?: string;
}

export interface RejectExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly rejectedEvent: Event;
}

export async function rejectExpenseInTx(
  input: RejectExpenseInTxInput,
): Promise<RejectExpenseInTxResult> {
  const { tx, expense, reason } = input;
  assertValidTransition(expense.status, "rejected");
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();

  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  if (expense.holdId) {
    await rollbackHoldInTx(tx, expense.holdId);
  }

  const rejectedEvent = await appendFundEventInTx(
    tx,
    fundId,
    toEventInput({
      fund_id: fundId,
      type: "expense.rejected",
      actor,
      occurred_at: time,
      payload: {
        expense_id: expense.id,
        reason,
      },
    }),
  );

  const updatedExpense = rejectExpense(expense, reason, time);

  return {
    updatedExpense,
    rejectedEvent,
  };
}

export interface ExpireExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly actorPseudonym?: PseudonymId;
  readonly nowUtc?: string;
}

export interface ExpireExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly expiredEvent: Event;
}

export async function expireExpenseInTx(
  input: ExpireExpenseInTxInput,
): Promise<ExpireExpenseInTxResult> {
  const { tx, expense } = input;
  assertValidTransition(expense.status, "expired");
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();

  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  if (expense.holdId) {
    await rollbackHoldInTx(tx, expense.holdId);
  }

  const expiredEvent = await appendFundEventInTx(
    tx,
    fundId,
    toEventInput({
      fund_id: fundId,
      type: "expense.expired",
      actor,
      occurred_at: time,
      payload: {
        expense_id: expense.id,
      },
    }),
  );

  const updatedExpense = expireExpense(expense, time);

  return {
    updatedExpense,
    expiredEvent,
  };
}

export interface PayExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly bankTransactionId: string;
  readonly actorPseudonym?: PseudonymId;
  readonly nowUtc?: string;
}

export interface PayExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly journalId: string;
  readonly paidEvent: Event;
}

export async function payExpenseInTx(input: PayExpenseInTxInput): Promise<PayExpenseInTxResult> {
  const { tx, expense, bankTransactionId } = input;
  assertValidTransition(expense.status, "paid");
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();

  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  if (!expense.holdId) {
    throw new Error(`Cannot pay expense ${expense.id} without an active hold`);
  }

  const commitRes = await commitHoldInTx(tx, expense.holdId, {
    fundId,
    expenseId: expense.id,
  });

  const paidEvent = await appendFundEventInTx(
    tx,
    fundId,
    toEventInput({
      fund_id: fundId,
      type: "expense.paid",
      actor,
      occurred_at: time,
      payload: {
        expense_id: expense.id,
        bank_transaction_id: bankTransactionId,
      },
    }),
  );

  const updatedExpense = payExpense(expense, bankTransactionId, time);

  return {
    updatedExpense,
    journalId: commitRes.journalId,
    paidEvent,
  };
}

export interface ReconcileExpenseInTxInput {
  readonly tx: KontoTransactionExecutor;
  readonly expense: ExpenseRequest;
  readonly bankTransactionId: string;
  readonly actorPseudonym?: PseudonymId;
  readonly nowUtc?: string;
}

export interface ReconcileExpenseInTxResult {
  readonly updatedExpense: ExpenseRequest;
  readonly debitEvent: Event;
}

export async function reconcileExpenseInTx(
  input: ReconcileExpenseInTxInput,
): Promise<ReconcileExpenseInTxResult> {
  const { tx, expense, bankTransactionId } = input;
  assertValidTransition(expense.status, "reconciled");
  const fundId = expense.fundId;
  const actor = input.actorPseudonym ?? SYSTEM_ACTOR;
  const time = input.nowUtc ?? nowUtcIso();
  const updatedExpense = reconcileExpense(expense, bankTransactionId, time);

  await tx`SELECT pg_advisory_xact_lock(hashtext(${fundId}))`;

  const debitEvent = await appendFundEventInTx(
    tx,
    fundId,
    toEventInput({
      fund_id: fundId,
      type: "bank.debit_seen",
      actor,
      occurred_at: time,
      payload: {
        bank_transaction_id: bankTransactionId,
        amount_paise: expense.amountPaise,
      },
    }),
  );

  return {
    updatedExpense,
    debitEvent,
  };
}
