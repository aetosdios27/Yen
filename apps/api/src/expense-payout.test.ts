import {
  type ExpenseRequest,
  InMemoryPayoutKillSwitch,
  type PartnerPayoutAdapter,
  type PseudonymId,
} from "@yen/ledger";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { PayoutService } from "./payout-service";

describe("Expense Payout Security Routes (YEN-43)", () => {
  const FUND_ID = "00000000-0000-4000-8000-000000000001";
  const APPROVER_1 = "00000000-0000-4000-8000-000000000010" as PseudonymId;
  const APPROVER_2 = "00000000-0000-4000-8000-000000000011" as PseudonymId;
  const TREASURER = "00000000-0000-4000-8000-000000000020" as PseudonymId;

  function mockApprovedExpense(id: string): ExpenseRequest {
    return {
      id,
      fundId: FUND_ID,
      requesterId: "00000000-0000-4000-8000-000000000030" as PseudonymId,
      amountPaise: paise(50000),
      purpose: "Equipment purchase",
      category: "equipment",
      recipientRef: "vendor@bank",
      status: "approved",
      approvals: [
        { approverId: APPROVER_1, approvedAt: new Date().toISOString(), signature: "sig1" },
        { approverId: APPROVER_2, approvedAt: new Date().toISOString(), signature: "sig2" },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  it("orchestrator enforces maker-checker: initiator cannot be an approver", async () => {
    const initiatedCalls: unknown[] = [];
    const adapter: PartnerPayoutAdapter = {
      async initiate(req) {
        initiatedCalls.push(req);
        return { providerPayoutId: req.idempotencyKey, status: "accepted" as const };
      },
    };
    const killSwitch = new InMemoryPayoutKillSwitch();
    const service = new PayoutService(adapter, killSwitch);

    const expense = mockApprovedExpense("exp-1");

    // Approver 1 cannot initiate payout for an expense they approved
    await expect(service.initiate(expense, APPROVER_1)).rejects.toThrow(
      "Payout initiator cannot be an approver",
    );
    expect(initiatedCalls).toHaveLength(0);

    // Independent treasurer CAN initiate payout
    const result = await service.initiate(expense, TREASURER);
    expect(result.payout.providerPayoutId).toBe(`payout:${FUND_ID}:exp-1`);
    expect(result.replayed).toBe(false);
    expect(initiatedCalls).toHaveLength(1);
  });

  it("orchestrator enforces per-fund emergency kill switch", async () => {
    const adapter: PartnerPayoutAdapter = {
      async initiate(req) {
        return { providerPayoutId: req.idempotencyKey, status: "accepted" as const };
      },
    };
    const killSwitch = new InMemoryPayoutKillSwitch();
    const service = new PayoutService(adapter, killSwitch);
    const expense = mockApprovedExpense("exp-2");

    killSwitch.setDisabled(FUND_ID, true);
    await expect(service.initiate(expense, TREASURER)).rejects.toThrow(
      `Payouts are disabled for fund ${FUND_ID}`,
    );

    killSwitch.setDisabled(FUND_ID, false);
    const result = await service.initiate(expense, TREASURER);
    expect(result.replayed).toBe(false);
  });
});
