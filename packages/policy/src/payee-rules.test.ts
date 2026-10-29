import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FRAUD_POLICY, DeterministicFakePayeeVerifier, evaluatePayeeFraud, failClosedPayeeVerifier, type FraudEvaluationInput } from "./payee-rules.js";

const base: FraudEvaluationInput = {
  expense: { id: "e1", amountPaise: 50_000 as never, requesterId: "psn_requester", payeeKey: "upi:shop@bank", at: "2026-01-01T00:00:00.000Z" },
  priorExpenses: [], isFirstPaymentToPayee: false, memberAndRequesterPayeeKeys: [],
};

describe("payee fraud rules", () => {
  it("flags the configured large first payment", () => {
    const flags = evaluatePayeeFraud({ ...base, isFirstPaymentToPayee: true, expense: { ...base.expense, amountPaise: DEFAULT_FRAUD_POLICY.newPayeeFirstPaymentPaise } });
    expect(flags.map(flag => flag.code)).toContain("new_payee_large_first_payment");
  });
  it("flags self payment, split requests, and payee velocity", () => {
    const flags = evaluatePayeeFraud({ ...base, memberAndRequesterPayeeKeys: [base.expense.payeeKey], priorExpenses: [{ ...base.expense, id: "e0", amountPaise: 2_000_000 as never, at: "2025-12-31T23:00:00.000Z" }] });
    expect(new Set(flags.map(flag => flag.code))).toEqual(new Set(["self_payment", "split_requests", "payee_velocity"]));
  });
  it("detects duplicate invoice and evidence using store results", () => {
    const flags = evaluatePayeeFraud({ ...base, expense: { ...base.expense, invoiceNumber: "I-1", evidenceHashes: ["abc"] }, existingEvidence: { invoiceAlreadyUsed: true, evidenceHashesAlreadyUsed: ["abc"] } });
    expect(flags.map(flag => flag.code)).toEqual(["duplicate_invoice", "duplicate_evidence"]);
  });
  it("verifier defaults fail closed and the fake provider is deterministic", async () => {
    const payee = { identity: { kind: "upi" as const, vpa: " shop@bank " }, name: "Shop", verification: { status: "unverified" as const } };
    expect(await failClosedPayeeVerifier.verify(payee)).toEqual({ status: "unverified" });
    const fake = new DeterministicFakePayeeVerifier();
    expect(await fake.verify(payee)).toEqual(await fake.verify(payee));
  });
  it("never flags first-payment rule below its threshold (property)", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: Number(DEFAULT_FRAUD_POLICY.newPayeeFirstPaymentPaise) - 1 }), amount => {
      const flags = evaluatePayeeFraud({ ...base, isFirstPaymentToPayee: true, expense: { ...base.expense, amountPaise: amount as never } });
      expect(flags.some(flag => flag.code === "new_payee_large_first_payment")).toBe(false);
    }));
  });
});
