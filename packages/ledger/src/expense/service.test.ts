import type { KontoTransactionExecutor } from "@konto-ledger/types";
import type { PseudonymId } from "@yen/eventlog";
import { paise } from "@yen/shared";
import { describe, expect, it, vi } from "vitest";
import {
  approveExpenseInTx,
  expireExpenseInTx,
  payExpenseInTx,
  reconcileExpenseInTx,
  rejectExpenseInTx,
  submitExpenseInTx,
} from "./service.js";
import { createDraftRequest } from "./state-machine.js";
import { type ExpenseRequest, type FundPolicy, InvalidStateTransitionError } from "./types.js";

const policy: FundPolicy = {
  approvalQuorum: 1,
  objectionWindowHours: 0,
  autoExpireHours: 24,
};

function rejectedExpense(): ExpenseRequest {
  return {
    ...createDraftRequest({
      fundId: "0194ebc4-94e8-7000-8000-000000000001",
      requesterId: "psn_0194ebc4-94e8-7000-8000-000000000002" as PseudonymId,
      amountPaise: paise(5000),
      description: "Office supplies",
      recipientRef: "recipient-1",
    }),
    status: "rejected",
    holdId: "hold-1",
  };
}

describe("expense transaction transition guards", () => {
  it.each([
    [
      "submit",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) =>
        submitExpenseInTx({ tx, expense, policy }),
    ],
    [
      "approve",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) =>
        approveExpenseInTx({
          tx,
          expense,
          approval: {
            approverId: "psn_0194ebc4-94e8-7000-8000-000000000003" as PseudonymId,
            passkeySignature: {
              credentialId: "credential",
              signatureHex: "00",
              clientDataJson: "{}",
              authenticatorDataHex: "00",
            },
            approvedAt: "2026-10-29T00:00:00.000Z",
          },
          policy,
        }),
    ],
    [
      "reject",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) =>
        rejectExpenseInTx({ tx, expense, reason: "policy" }),
    ],
    [
      "expire",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) => expireExpenseInTx({ tx, expense }),
    ],
    [
      "pay",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) =>
        payExpenseInTx({ tx, expense, bankTransactionId: "bank-tx-1" }),
    ],
    [
      "reconcile",
      (tx: KontoTransactionExecutor, expense: ExpenseRequest) =>
        reconcileExpenseInTx({ tx, expense, bankTransactionId: "bank-tx-1" }),
    ],
  ])("rejects an illegal %s before issuing transactional queries", async (_name, action) => {
    const query = vi.fn(() => {
      throw new Error("transaction must not be touched for an illegal transition");
    });
    const tx = query as unknown as KontoTransactionExecutor;

    await expect(action(tx, rejectedExpense())).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(query).not.toHaveBeenCalled();
  });
});
