import { expireExpense } from "./state-machine.js";
import type { ExpenseRequest } from "./types.js";

export function findStaleExpenses(
  expenses: readonly ExpenseRequest[],
  nowUtc: string,
): ExpenseRequest[] {
  const nowMs = Date.parse(nowUtc);
  return expenses.filter(
    (e) => e.status === "submitted" && e.expiresAt !== null && nowMs >= Date.parse(e.expiresAt),
  );
}

export async function processStaleExpenses(
  expenses: readonly ExpenseRequest[],
  nowUtc: string,
  onExpire: (expiredExpense: ExpenseRequest) => Promise<void> | void,
): Promise<ExpenseRequest[]> {
  const stale = findStaleExpenses(expenses, nowUtc);
  const results: ExpenseRequest[] = [];
  for (const exp of stale) {
    const expired = expireExpense(exp, nowUtc);
    await onExpire(expired);
    results.push(expired);
  }
  return results;
}
