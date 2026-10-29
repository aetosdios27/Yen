import type { PseudonymId } from "@yen/eventlog";
import type { FraudPolicy } from "@yen/policy";
import { addSignedApproval } from "./state-machine.js";
import {
  type ApprovalProofVerifier,
  ExpenseNotFoundError,
  type ExpenseRequest,
  FraudAcknowledgementConflictError,
  type FundPolicy,
  type SignedApproval,
} from "./types.js";

export interface ExpenseStore {
  get(expenseId: string): Promise<ExpenseRequest | null>;
  list(fundId: string): Promise<ExpenseRequest[]>;
  save(
    expense: ExpenseRequest,
    context?: {
      readonly actorId?: PseudonymId;
      readonly actorUserId?: string;
      readonly policy?: FundPolicy;
    },
  ): Promise<ExpenseRequest | undefined>;
  atomicApprove(
    expenseId: string,
    approval: SignedApproval,
    policy: FundPolicy,
    verifyApprovalProof: ApprovalProofVerifier,
    nowUtc?: string,
    actorUserId?: string,
    fraudPolicy?: FraudPolicy,
  ): Promise<{ expense: ExpenseRequest; reachedQuorum: boolean }>;
}

export class InMemoryExpenseStore implements ExpenseStore {
  private readonly items = new Map<string, ExpenseRequest>();
  private readonly locks = new Map<string, Promise<unknown>>();

  private async acquireLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      try {
        await this.locks.get(key);
      } catch {
        // ignore errors from previous holder
      }
    }
    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(key, lockPromise);
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      resolveLock();
    }
  }

  async get(expenseId: string): Promise<ExpenseRequest | null> {
    const found = this.items.get(expenseId);
    return found ? { ...found } : null;
  }

  async list(fundId: string): Promise<ExpenseRequest[]> {
    const results: ExpenseRequest[] = [];
    for (const item of this.items.values()) {
      if (item.fundId === fundId) {
        results.push({ ...item });
      }
    }
    return results;
  }

  async save(expense: ExpenseRequest): Promise<ExpenseRequest> {
    return this.acquireLock(expense.id, async () => {
      const current = this.items.get(expense.id);
      assertAcknowledgementsUnchanged(current, expense);
      this.items.set(expense.id, { ...expense });
      return { ...expense };
    });
  }

  async atomicApprove(
    expenseId: string,
    approval: SignedApproval,
    policy: FundPolicy,
    verifyApprovalProof: ApprovalProofVerifier,
    nowUtc?: string,
    _actorUserId?: string,
    fraudPolicy?: FraudPolicy,
  ): Promise<{ expense: ExpenseRequest; reachedQuorum: boolean }> {
    return this.acquireLock(expenseId, async () => {
      const current = this.items.get(expenseId);
      if (!current) {
        throw new ExpenseNotFoundError(expenseId);
      }
      const res = addSignedApproval(
        current,
        approval,
        policy,
        verifyApprovalProof,
        nowUtc,
        fraudPolicy,
      );
      this.items.set(expenseId, res.expense);
      return res;
    });
  }
}

export function assertAcknowledgementsUnchanged(
  current: ExpenseRequest | undefined,
  next: ExpenseRequest,
): void {
  if (!current || current.fraudEvaluationId !== next.fraudEvaluationId) return;
  for (const acknowledgement of current.fraudAcknowledgements) {
    const replacement = next.fraudAcknowledgements.find(
      (item) => item.code === acknowledgement.code,
    );
    if (
      !replacement ||
      replacement.actorPseudonym !== acknowledgement.actorPseudonym ||
      replacement.reason !== acknowledgement.reason ||
      replacement.acknowledgedAt !== acknowledgement.acknowledgedAt
    ) {
      throw new FraudAcknowledgementConflictError();
    }
  }
}
