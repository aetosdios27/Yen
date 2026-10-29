import type { Paise } from "@yen/shared";
import type { ExpenseRequest, PseudonymId } from "./expense/types.js";

/** A provider-facing request. Amounts are always integer paise. */
export interface PartnerPayoutRequest {
  readonly fundId: string;
  readonly expenseId: string;
  readonly recipientRef: string;
  readonly amountPaise: Paise;
  readonly idempotencyKey: string;
}

export interface PartnerPayoutResult {
  readonly providerPayoutId: string;
  readonly status: "accepted";
}

/** Adapter boundary for a bank or regulated payout partner. */
export interface PartnerPayoutAdapter {
  initiate(request: PartnerPayoutRequest): Promise<PartnerPayoutResult>;
}

export interface PayoutRecord extends PartnerPayoutResult {
  readonly fundId: string;
  readonly expenseId: string;
  readonly recipientRef: string;
  readonly amountPaise: Paise;
  readonly idempotencyKey: string;
  readonly initiatedBy: PseudonymId;
}

export interface PayoutOutcome {
  readonly payout: PayoutRecord;
  readonly replayed: boolean;
}

export class MakerCheckerViolationError extends Error {
  constructor() {
    super("Payout initiator cannot be an approver of the expense");
  }
}

export class PayoutsDisabledError extends Error {
  constructor(fundId: string) {
    super(`Payouts are disabled for fund ${fundId}`);
  }
}

export class PayoutIdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Payout idempotency conflict for ${key}`);
  }
}

export class PayoutNotApprovedError extends Error {
  constructor(expenseId: string) {
    super(`Expense ${expenseId} must be approved before a payout can be initiated`);
  }
}

/** Per-fund emergency control. Disabled funds reject only new payout attempts. */
export class InMemoryPayoutKillSwitch {
  private readonly disabledFunds = new Set<string>();

  setDisabled(fundId: string, disabled: boolean): void {
    if (disabled) this.disabledFunds.add(fundId);
    else this.disabledFunds.delete(fundId);
  }

  isDisabled(fundId: string): boolean {
    return this.disabledFunds.has(fundId);
  }
}

/**
 * Serializes a deterministic (fund, expense) payout initiation and protects
 * the provider from duplicate debits across retries in one process.
 */
export class PayoutOrchestrator {
  private readonly payouts = new Map<string, PayoutRecord>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly adapter: PartnerPayoutAdapter,
    private readonly killSwitch: InMemoryPayoutKillSwitch = new InMemoryPayoutKillSwitch(),
  ) {}

  async initiate(input: {
    readonly expense: ExpenseRequest;
    readonly initiatorId: PseudonymId;
  }): Promise<PayoutOutcome> {
    const { expense, initiatorId } = input;
    if (expense.status !== "approved") throw new PayoutNotApprovedError(expense.id);
    if (expense.approvals.some((approval) => approval.approverId === initiatorId)) {
      throw new MakerCheckerViolationError();
    }

    const key = payoutIdempotencyKey(expense.fundId, expense.id);
    return this.withLock(key, async () => {
      const existing = this.payouts.get(key);
      if (existing) {
        if (
          existing.amountPaise !== expense.amountPaise ||
          existing.recipientRef !== expense.recipientRef ||
          existing.initiatedBy !== initiatorId
        ) {
          throw new PayoutIdempotencyConflictError(key);
        }
        return { payout: existing, replayed: true };
      }
      if (this.killSwitch.isDisabled(expense.fundId))
        throw new PayoutsDisabledError(expense.fundId);

      const result = await this.adapter.initiate({
        fundId: expense.fundId,
        expenseId: expense.id,
        recipientRef: expense.recipientRef,
        amountPaise: expense.amountPaise,
        idempotencyKey: key,
      });
      const payout: PayoutRecord = {
        ...result,
        fundId: expense.fundId,
        expenseId: expense.id,
        recipientRef: expense.recipientRef,
        amountPaise: expense.amountPaise,
        idempotencyKey: key,
        initiatedBy: initiatorId,
      };
      this.payouts.set(key, payout);
      return { payout, replayed: false };
    });
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) await this.locks.get(key);
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, lock);
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      release();
    }
  }
}

export function payoutIdempotencyKey(fundId: string, expenseId: string): string {
  return `payout:${fundId}:${expenseId}`;
}
