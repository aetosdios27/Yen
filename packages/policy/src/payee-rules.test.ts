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
  profileFingerprints: [],
  requesterHasProfile: false,
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
  it("does not flag a large payment as first when it has already been paid to the payee", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      isFirstPaymentToPayee: false,
      expense: { ...base.expense, amountPaise: DEFAULT_FRAUD_POLICY.newPayeeFirstPaymentPaise },
    });
    expect(flags.some((flag) => flag.code === "new_payee_large_first_payment")).toBe(false);
  });
  it("flags self payment, split requests, and payee velocity", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      profileFingerprints: [base.expense.payeeKey],
      requesterHasProfile: true,
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
  it("explains when a matching member profile exists but the requester has no profile", () => {
    const selfPayment = evaluatePayeeFraud({
      ...base,
      profileFingerprints: [base.expense.payeeKey],
      requesterHasProfile: false,
    }).find((flag) => flag.code === "self_payment");
    expect(selfPayment?.reason).toContain("requester has no payee profile");
    expect(selfPayment?.reason).toContain("only a requester display-name check");
  });
  it("uses only the requester display name as a fallback when the requester has no profile", () => {
    const selfPayment = evaluatePayeeFraud({
      ...base,
      payeeName: "  Meera   Rao ",
      requesterDisplayName: "meera rao",
    }).find((flag) => flag.code === "self_payment");
    expect(selfPayment?.reason).toContain("requester's stored fund display name");
    expect(selfPayment?.reason).toContain("requester-only comparison was used");
  });
  it("does not use requester-name fallback when a requester payee profile exists", () => {
    const selfPayment = evaluatePayeeFraud({
      ...base,
      requesterHasProfile: true,
      payeeName: "Meera Rao",
      requesterDisplayName: "Meera Rao",
    }).find((flag) => flag.code === "self_payment");
    expect(selfPayment).toBeUndefined();
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
  it("does not flag a change at the cooling-off boundary or a future change timestamp", () => {
    const atBoundary = evaluatePayeeFraud({
      ...base,
      changedPayeeAt: "2025-12-31T00:00:00.000Z",
      expense: { ...base.expense, amountPaise: paise(500_000) },
    });
    const futureTimestamp = evaluatePayeeFraud({
      ...base,
      changedPayeeAt: "2026-01-02T00:00:00.000Z",
      expense: { ...base.expense, amountPaise: paise(500_000) },
    });
    expect(atBoundary.some((flag) => flag.code === "payee_changed_cooling_off")).toBe(false);
    expect(futureTimestamp.some((flag) => flag.code === "payee_changed_cooling_off")).toBe(false);
  });
  it("flags split requests only when the same payee exceeds the threshold in-window", () => {
    const prior = {
      ...base.expense,
      id: "e-prior",
      amountPaise: paise(600_000),
      at: "2025-12-31T23:30:00.000Z",
    };
    const split = evaluatePayeeFraud({
      ...base,
      expense: { ...base.expense, amountPaise: paise(500_000) },
      priorExpenses: [prior],
    });
    const differentPayee = evaluatePayeeFraud({
      ...base,
      expense: { ...base.expense, amountPaise: paise(500_000) },
      priorExpenses: [{ ...prior, payeeKey: "upi:other@bank" }],
    });
    const outsideWindow = evaluatePayeeFraud({
      ...base,
      expense: { ...base.expense, amountPaise: paise(500_000) },
      priorExpenses: [{ ...prior, at: "2025-12-30T23:59:00.000Z" }],
    });
    expect(split.some((flag) => flag.code === "split_requests")).toBe(true);
    expect(differentPayee.some((flag) => flag.code === "split_requests")).toBe(false);
    expect(outsideWindow.some((flag) => flag.code === "split_requests")).toBe(false);
  });
  it("flags malformed declared GSTIN values", () => {
    const flags = evaluatePayeeFraud({ ...base, declaredGstin: "not-a-gstin" });
    expect(flags.map((flag) => flag.code)).toContain("gstin_name_mismatch");
  });
  it("flags invoice-vendor and payee name mismatch when a GSTIN is declared", () => {
    const mismatch = evaluatePayeeFraud({
      ...base,
      declaredGstin: "27AAPFU0939F1ZV",
      payeeName: "Community Supplies",
      invoiceVendorName: "Different Vendor",
    });
    const matching = evaluatePayeeFraud({
      ...base,
      declaredGstin: "27AAPFU0939F1ZV",
      payeeName: "Community Supplies Pvt Ltd",
      invoiceVendorName: " community   supplies pvt ltd ",
    });
    expect(mismatch.some((flag) => flag.code === "gstin_name_mismatch")).toBe(true);
    expect(matching.some((flag) => flag.code === "gstin_name_mismatch")).toBe(false);
  });
  it("uses per-payee velocity across the configured rolling window", () => {
    const flags = evaluatePayeeFraud({
      ...base,
      expense: { ...base.expense, amountPaise: paise(1_000_000) },
      priorExpenses: [
        {
          ...base.expense,
          id: "e-prior",
          amountPaise: paise(1_100_000),
          at: "2025-12-31T23:00:00.000Z",
        },
      ],
    });
    expect(flags.some((flag) => flag.code === "payee_velocity")).toBe(true);
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
  it("always blocks self-payment even if a malformed policy omits it from the configurable subset", () => {
    const policy = { ...DEFAULT_FRAUD_POLICY, blockedFlagCodes: [] };
    expect(
      hasUnacknowledgedBlockingFlags(
        [{ code: "self_payment", reason: "Payee matches a member." }],
        [],
        policy,
      ),
    ).toBe(true);
  });
  it("verifier defaults fail closed and the fake provider is deterministic", async () => {
    const payee = {
      identity: { kind: "upi" as const, vpa: " shop@bank " },
      name: "Shop",
      verification: { status: "unverified" as const },
    };
    expect(await failClosedPayeeVerifier.verify(payee)).toEqual({ status: "unverified" });
    const fake = new DeterministicFakePayeeVerifier();
    const fakeResult = await fake.verify(payee);
    expect(fakeResult).toEqual(await fake.verify(payee));
    expect(fakeResult.reference).not.toContain("shop@bank");
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
  it("never flags payee velocity when the sum stays at or below the configured maximum (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number(DEFAULT_FRAUD_POLICY.velocityMaxPaise) }),
        (amount) => {
          const flags = evaluatePayeeFraud({
            ...base,
            expense: { ...base.expense, amountPaise: paise(amount) },
          });
          expect(flags.some((flag) => flag.code === "payee_velocity")).toBe(false);
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
