import { paise, parsePseudonymId } from "@yen/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createUnverifiedPayee,
  DEFAULT_FRAUD_POLICY,
  DeterministicFakePayeeVerifier,
  evaluatePayeeFraud,
  type FraudEvaluationInput,
  failClosedPayeeVerifier,
  hasUnacknowledgedBlockingFlags,
} from "./payee-rules.js";

const requester = parsePseudonymId("psn_00000000-0000-7000-8000-000000000002");
if (!requester.ok) throw new Error("Expected a valid fund pseudonym");

const base: FraudEvaluationInput = {
  expense: {
    id: "e1",
    amountPaise: paise(50_000),
    requesterId: requester.value,
    payeeKey: "upi:shop@bank",
    at: "2026-01-01T00:00:00.000Z",
  },
  priorExpenses: [],
  isFirstPaymentToPayee: false,
  memberAndRequesterPayeeKeys: [],
};

describe("payee fraud rules", () => {
  it("normalizes payee identity and leaves verification unverified", () => {
    expect(
      createUnverifiedPayee({
        identity: { kind: "bank", account: " 1234 5678 ", ifsc: "ab cd0123" },
        name: "  Shop   Name ",
        gstin: "27ABCDE1234F1Z5",
      }),
    ).toEqual({
      identity: { kind: "bank", account: "12345678", ifsc: "ABCD0123" },
      name: "Shop Name",
      gstin: "27ABCDE1234F1Z5",
      verification: { status: "unverified" },
    });
  });
  it("flags the configured large first payment", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      isFirstPaymentToPayee: true,
      expense: { ...base.expense, amountPaise: DEFAULT_FRAUD_POLICY.newPayeeFirstPaymentPaise },
    });
    expect(flags.map((flag) => flag.code)).toContain("new_payee_large_first_payment");
  });
  it("flags self payment, split requests, and payee velocity", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      memberAndRequesterPayeeKeys: [base.expense.payeeKey],
      priorExpenses: [
        {
          ...base.expense,
          id: "e0",
          amountPaise: paise(2_000_000),
          at: "2025-12-31T23:00:00.000Z",
        },
      ],
    });
    expect(new Set(flags.map((flag) => flag.code))).toEqual(
      new Set(["self_payment", "split_requests", "payee_velocity"]),
    );
  });
  it("detects duplicate invoice and evidence using store results", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      expense: { ...base.expense, invoiceNumber: "I-1", evidenceHashes: ["abc"] },
      existingEvidence: { invoiceAlreadyUsed: true, evidenceHashesAlreadyUsed: ["abc"] },
    });
    expect(flags.map((flag) => flag.code)).toEqual(["duplicate_invoice", "duplicate_evidence"]);
  });
  it("flags payee changes inside the cooling-off period", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      changedPayeeAt: "2025-12-31T23:00:00.000Z",
      expense: { ...base.expense, amountPaise: paise(500_000) },
    });
    expect(flags.map((flag) => flag.code)).toContain("payee_changed_cooling_off");
  });
  it("flags malformed declared GSTIN values", () => {
    const flags = evaluatePayeeFraud({ ...base, declaredGstin: "not-a-gstin" });
    expect(flags.map((flag) => flag.code)).toContain("gstin_name_mismatch");
  });
  it("blocks approval until a blocking flag has an acknowledgement with a reason", () => {
    const flags = [{ code: "self_payment" as const, reason: "Payee matches a member." }];
    expect(hasUnacknowledgedBlockingFlags(flags, [])).toBe(true);
    const actor = parsePseudonymId("psn_00000000-0000-7000-8000-000000000001");
    if (!actor.ok) throw new Error("Expected a valid fund pseudonym");
    expect(
      hasUnacknowledgedBlockingFlags(flags, [
        {
          code: "self_payment",
          actorPseudonym: actor.value,
          reason: "Owner reviewed the payee.",
          acknowledgedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    ).toBe(false);
  });
  it("verifier defaults fail closed and the fake provider is deterministic", async () => {
    const payee = {
      identity: { kind: "upi" as const, vpa: " shop@bank " },
      name: "Shop",
      verification: { status: "unverified" as const },
    };
    expect(await failClosedPayeeVerifier.verify(payee)).toEqual({ status: "unverified" });
    const fake = new DeterministicFakePayeeVerifier();
    expect(await fake.verify(payee)).toEqual(await fake.verify(payee));
  });
  it("never flags first-payment rule below its threshold (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number(DEFAULT_FRAUD_POLICY.newPayeeFirstPaymentPaise) - 1 }),
        (amount) => {
          const flags = evaluatePayeeFraud({
            ...base,
            isFirstPaymentToPayee: true,
            expense: { ...base.expense, amountPaise: paise(amount) },
          });
          expect(flags.some((flag) => flag.code === "new_payee_large_first_payment")).toBe(false);
        },
      ),
    );
  });
  it("never blocks an unconfigured flag code (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "new_payee_large_first_payment",
          "payee_changed_cooling_off",
          "split_requests",
          "payee_velocity",
        ),
        (code) => {
          if (DEFAULT_FRAUD_POLICY.blockedFlagCodes.includes(code)) return;
          expect(hasUnacknowledgedBlockingFlags([{ code, reason: "Review required." }], [])).toBe(
            false,
          );
        },
      ),
    );
  });
});
