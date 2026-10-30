import { parsePseudonymId } from "@yen/eventlog";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import type { ExpenseRequest } from "./expense/types.js";
import {
  InMemoryPayoutKillSwitch,
  MakerCheckerViolationError,
  type PartnerPayoutRequest,
  PayoutOrchestrator,
  PayoutsDisabledError,
  payoutIdempotencyKey,
} from "./payout.js";

const fundId = "00000000-0000-7000-8000-000000000001";
const expenseId = "00000000-0000-7000-8000-000000000002";
const approver = parsePseudonymId("psn_00000000-0000-7000-8000-000000000003");
const maker = parsePseudonymId("psn_00000000-0000-7000-8000-000000000004");

function approvedExpense(): ExpenseRequest {
  return {
    id: expenseId,
    fundId,
    requesterId: parsePseudonymId("psn_00000000-0000-7000-8000-000000000005"),
    amountPaise: paise(12500),
    description: "Venue deposit",
    recipientRef: "vendor@upi",
    payee: {
      identity: { kind: "upi", vpa: "vendor@upi" },
      name: "Vendor",
      verification: { status: "unverified" },
    },
    payeeFingerprint: "fp_vendor_upi",
    lastPayeeChangedAt: "2026-01-01T00:00:00.000Z",
    fraudEvaluationId: null,
    fraudFlags: [],
    fraudAcknowledgements: [],
    status: "approved",
    holdId: "hold-1",
    approvals: [
      {
        approverId: approver,
        approvedAt: "2026-01-01T00:00:00.000Z",
        passkeySignature: {
          credentialId: "credential",
          signatureHex: "00",
          clientDataJson: "{}",
          authenticatorDataHex: "00",
        },
      },
    ],
    evidence: [],
    supersedesId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    submittedAt: "2026-01-01T00:00:00.000Z",
    objectionEndsAt: null,
    approvedAt: "2026-01-01T00:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: null,
    reconciledAt: null,
    bankTransactionId: null,
    expiresAt: null,
  };
}

describe("PayoutOrchestrator", () => {
  it("rejects an expense approver as the payout initiator", async () => {
    const orchestrator = new PayoutOrchestrator({
      initiate: async () => ({ providerPayoutId: "partner-1", status: "accepted" }),
    });

    await expect(
      orchestrator.initiate({ expense: approvedExpense(), initiatorId: approver }),
    ).rejects.toBeInstanceOf(MakerCheckerViolationError);
  });

  it("rejects new payout batches while the fund kill switch is enabled", async () => {
    const killSwitch = new InMemoryPayoutKillSwitch();
    killSwitch.setDisabled(fundId, true);
    const orchestrator = new PayoutOrchestrator(
      { initiate: async () => ({ providerPayoutId: "partner-1", status: "accepted" }) },
      killSwitch,
    );

    await expect(
      orchestrator.initiate({ expense: approvedExpense(), initiatorId: maker }),
    ).rejects.toBeInstanceOf(PayoutsDisabledError);
  });

  it("replays a deterministic (fund, expense) payout without another provider debit", async () => {
    const calls: PartnerPayoutRequest[] = [];
    const orchestrator = new PayoutOrchestrator({
      initiate: async (request) => {
        calls.push(request);
        return { providerPayoutId: "partner-1", status: "accepted" };
      },
    });
    const first = await orchestrator.initiate({ expense: approvedExpense(), initiatorId: maker });
    const retry = await orchestrator.initiate({ expense: approvedExpense(), initiatorId: maker });

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.payout).toEqual(first.payout);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.idempotencyKey).toBe(payoutIdempotencyKey(fundId, expenseId));
    expect(calls[0]?.amountPaise).toBe(paise(12500));
  });
});
