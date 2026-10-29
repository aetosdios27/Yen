import { type Sql, uuidv7 } from "@yen/db";
import { parsePseudonymId } from "@yen/eventlog";
import {
  appendFundEventInTx,
  deterministicUuid,
  getBalances,
  nowUtcIso,
  settleExpense,
  toEventInput,
} from "@yen/ledger";
import { type AnchorAlert, type AnchorAlertSink, stderrAnchorAlertSink } from "@yen/queue";
import type { ParsedBankTransaction } from "./types.js";

type Tx = Parameters<typeof settleExpense>[0];

export type DebitAlertSink = AnchorAlertSink;
export type DebitAlert = AnchorAlert;
export const stderrDebitAlertSink = stderrAnchorAlertSink;

export async function checkBankBalance(
  sql: Sql,
  fundId: string,
  reportedBalancePaise: bigint,
  alerts: DebitAlertSink = stderrDebitAlertSink,
): Promise<{ readonly matches: boolean; readonly ledgerBalancePaise: bigint }> {
  const ledgerBalancePaise = await sql.begin(
    async (tx) => (await getBalances(tx, fundId)).bankPaise,
  );
  const matches = ledgerBalancePaise === reportedBalancePaise;
  if (!matches) {
    await alerts.emit({
      type: "bank.balance_mismatch",
      fundId,
      details: JSON.stringify({
        ledgerBalancePaise: ledgerBalancePaise.toString(),
        reportedBalancePaise: reportedBalancePaise.toString(),
      }),
    });
  }
  return { matches, ledgerBalancePaise };
}

export type DebitDecision =
  | { readonly kind: "matched"; readonly expenseId: string; readonly confidence: number }
  | { readonly kind: "ambiguous"; readonly candidateExpenseIds: readonly string[] }
  | { readonly kind: "unapproved" };

export async function matchDebitInTx(
  tx: Tx,
  debit: ParsedBankTransaction,
  bankTransactionId: string,
): Promise<DebitDecision> {
  if (debit.type !== "debit") throw new TypeError("Debit matching requires a debit transaction");
  const candidates = await tx<
    {
      id: string;
      hold_id: string | null;
      expense_data: Record<string, unknown>;
    }[]
  >`
    SELECT id, hold_id, expense_data FROM expenses
    WHERE fund_id = ${debit.fundId} AND status = 'approved'
      AND (expense_data->>'amountPaise') = ${String(debit.amountPaise)}
      AND (expense_data->>'recipientRef') IN (${debit.counterpartyVpa ?? ""}, ${debit.counterpartyAccountFingerprint ?? ""})
      AND abs(extract(epoch FROM (${debit.postedAt}::timestamptz - (expense_data->>'approvedAt')::timestamptz)) / 86400) <= 7
    FOR UPDATE
  `;

  if (candidates.length > 1) {
    await tx`UPDATE bank_transactions SET reconciliation_status = 'ambiguous'
      WHERE id = ${bankTransactionId}`;
    return { kind: "ambiguous", candidateExpenseIds: candidates.map((row) => row.id) };
  }
  const match = candidates[0];
  if (!match) {
    await tx`INSERT INTO unapproved_debits (bank_transaction_id, fund_id)
      VALUES (${bankTransactionId}, ${debit.fundId}) ON CONFLICT (bank_transaction_id) DO NOTHING`;
    return { kind: "unapproved" };
  }
  if (!match.hold_id) throw new Error(`Approved expense ${match.id} has no ledger hold`);

  const ref = `${debit.bankReference} ${debit.utr ?? ""} ${debit.narration ?? ""}`;
  const confidence = ref.toLowerCase().includes(match.id.toLowerCase()) ? 0.99 : 0.92;
  await postDebitMatchInTx(tx, debit, bankTransactionId, match, {
    confidence,
    method: "heuristic_amount_time",
  });
  return { kind: "matched", expenseId: match.id, confidence };
}

export async function postDebitMatchInTx(
  tx: Tx,
  debit: ParsedBankTransaction,
  bankTransactionId: string,
  match: { id: string; hold_id: string | null; expense_data: Record<string, unknown> },
  options: {
    readonly confidence: number;
    readonly method: "heuristic_amount_time" | "manual";
    readonly actorPseudonym?: string;
    readonly reason?: string;
  },
): Promise<void> {
  if (!match.hold_id) throw new Error(`Approved expense ${match.id} has no ledger hold`);

  const occurredAt = nowUtcIso();
  const actor = options.actorPseudonym
    ? parsePseudonymId(options.actorPseudonym)
    : parsePseudonymId(`psn_${deterministicUuid(debit.fundId, "bank-debit-matcher")}`);
  await settleExpense(tx, {
    fundId: debit.fundId,
    holdId: match.hold_id,
    expenseId: match.id,
    bankTransactionId,
    actorPseudonym: actor,
    occurredAt,
  });
  await appendFundEventInTx(
    tx,
    debit.fundId,
    toEventInput({
      fund_id: debit.fundId,
      type: "bank.debit_seen",
      actor,
      occurred_at: occurredAt,
      payload: { amount_paise: debit.amountPaise, bank_transaction_id: bankTransactionId },
    }),
  );
  const expenseData = {
    ...match.expense_data,
    status: "paid",
    paidAt: debit.postedAt,
    bankTransactionId,
  };
  await tx`UPDATE expenses SET status = 'paid', expense_data = ${tx.json(expenseData)}, updated_at = ${occurredAt}
    WHERE id = ${match.id} AND status = 'approved'`;
  const reconciliationStatus = options.method === "manual" ? "manually_matched" : "matched";
  await tx`UPDATE bank_transactions SET reconciliation_status = ${reconciliationStatus}, matched_expense_id = ${match.id},
    matched_at = ${debit.postedAt}, match_confidence = ${options.confidence}, match_method = ${options.method},
    manual_match_reason = ${options.reason ?? null}, manual_match_by = ${options.actorPseudonym ?? null}
    WHERE id = ${bankTransactionId}`;
  if (options.method === "manual") {
    await tx`INSERT INTO debit_reconciliation_actions (
      id, fund_id, bank_transaction_id, action, expense_id, reason, actor_pseudonym, occurred_at
    ) VALUES (
      ${uuidv7()}, ${debit.fundId}, ${bankTransactionId}, 'manual_match', ${match.id},
      ${options.reason ?? ""}, ${options.actorPseudonym ?? ""}, ${occurredAt}
    )`;
  }
}
