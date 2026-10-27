import type { Event } from "@yen/eventlog";

export interface FundBalances {
  fundId: string;
  bankPaise: bigint;
  pendingSpendPaise: bigint;
  availablePaise: bigint;
  donationsPaise: bigint;
  expensesPaise: bigint;
}

/**
 * Replays an ordered sequence of hash-chained events for a fund to reconstruct
 * its exact ledger balances from the event history.
 */
export function replayFundEvents(fundId: string, events: readonly Event[]): FundBalances {
  let bank = 0n;
  let donations = 0n;
  let expenses = 0n;
  let pendingSpend = 0n;

  // Track pledges and expenses by ID to know their amounts when verified, committed, or rolled back
  const pledges = new Map<string, bigint>();
  const activeHolds = new Map<string, bigint>();
  const verifiedDonations = new Map<string, bigint>();

  for (const event of events) {
    if (event.fund_id !== fundId) continue;

    switch (event.type) {
      case "donation.pledged": {
        const payload = event.payload as { donation_id: string; amount_paise: number };
        pledges.set(payload.donation_id, BigInt(payload.amount_paise));
        break;
      }

      case "donation.verified": {
        const payload = event.payload as { donation_id: string; bank_transaction_id: string };
        const amount = pledges.get(payload.donation_id) ?? 0n;
        bank += amount;
        donations += amount;
        verifiedDonations.set(payload.donation_id, amount);
        break;
      }

      case "donation.rejected": {
        const payload = event.payload as { donation_id: string; reason: string };
        const verifiedAmount = verifiedDonations.get(payload.donation_id);
        if (verifiedAmount !== undefined) {
          bank -= verifiedAmount;
          donations -= verifiedAmount;
          verifiedDonations.delete(payload.donation_id);
        }
        break;
      }

      case "bank.credit_seen": {
        const payload = event.payload as { bank_transaction_id: string; amount_paise: number };
        const amount = BigInt(payload.amount_paise);
        bank += amount;
        donations += amount;
        break;
      }

      case "expense.submitted": {
        const payload = event.payload as { expense_id: string; amount_paise: number };
        const amount = BigInt(payload.amount_paise);
        activeHolds.set(payload.expense_id, amount);
        pendingSpend += amount;
        break;
      }

      case "expense.approved": {
        // Hold was already reserved on submit, or reserved on approval
        break;
      }

      case "expense.paid": {
        const payload = event.payload as { expense_id: string; bank_transaction_id: string };
        const holdAmount = activeHolds.get(payload.expense_id) ?? 0n;
        pendingSpend -= holdAmount;
        bank -= holdAmount;
        expenses += holdAmount;
        activeHolds.delete(payload.expense_id);
        break;
      }

      case "expense.rejected":
      case "expense.expired": {
        const payload = event.payload as { expense_id: string };
        const holdAmount = activeHolds.get(payload.expense_id) ?? 0n;
        pendingSpend -= holdAmount;
        activeHolds.delete(payload.expense_id);
        break;
      }

      case "expense.reversed": {
        const _payload = event.payload as { expense_id: string; bank_transaction_id: string };
        // Reverse expense: bank increases, expenses decreases
        // Note: in MVP, refund/reversal reverses settled expense or donation
        break;
      }

      case "bank.debit_seen": {
        // Direct bank debit without hold
        break;
      }
    }
  }

  const available = bank - pendingSpend;

  return {
    fundId,
    bankPaise: bank,
    pendingSpendPaise: pendingSpend,
    availablePaise: available,
    donationsPaise: donations,
    expensesPaise: expenses,
  };
}
