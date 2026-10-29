import {
  isValidGstinFormat,
  type Paise,
  type PseudonymId,
  paise,
  validateGstinChecksum,
} from "@yen/shared";

export type PayeeIdentity =
  | { readonly kind: "upi"; readonly vpa: string }
  | { readonly kind: "bank"; readonly account: string; readonly ifsc: string };
export type VerificationStatus = "unverified" | "verified" | "failed";
export interface Payee {
  readonly identity: PayeeIdentity;
  readonly name: string;
  readonly gstin?: string;
  readonly verification: {
    readonly status: VerificationStatus;
    readonly provider?: string;
    readonly reference?: string;
    readonly verifiedAt?: string;
  };
}
export function createUnverifiedPayee(input: {
  readonly identity: PayeeIdentity;
  readonly name: string;
  readonly gstin?: string;
}): Payee {
  const identity =
    input.identity.kind === "upi"
      ? { kind: "upi" as const, vpa: input.identity.vpa.trim().toLowerCase() }
      : {
          kind: "bank" as const,
          account: input.identity.account.replace(/\s/g, ""),
          ifsc: input.identity.ifsc.replace(/\s/g, "").toUpperCase(),
        };
  return {
    identity,
    name: input.name.normalize("NFKC").trim().replace(/\s+/g, " "),
    ...(input.gstin ? { gstin: input.gstin.trim().toUpperCase() } : {}),
    verification: { status: "unverified" },
  };
}
export interface PayeeVerifier {
  verify(payee: Payee): Promise<Payee["verification"]>;
}
export const failClosedPayeeVerifier: PayeeVerifier = {
  verify: async () => ({ status: "unverified" }),
};
export class DeterministicFakePayeeVerifier implements PayeeVerifier {
  async verify(payee: Payee) {
    const accepted = payee.name.trim().length > 0;
    return accepted
      ? {
          status: "verified" as const,
          provider: "yen-test-fake-v1",
          reference: `fake:${normalizePayeeKey(payee.identity)}`,
          verifiedAt: "2000-01-01T00:00:00.000Z",
        }
      : {
          status: "failed" as const,
          provider: "yen-test-fake-v1",
          reference: "fake:empty-name",
          verifiedAt: "2000-01-01T00:00:00.000Z",
        };
  }
}
export function normalizePayeeKey(identity: PayeeIdentity): string {
  return identity.kind === "upi"
    ? `upi:${identity.vpa.trim().toLowerCase()}`
    : `bank:${identity.account.replace(/\s/g, "")}:${identity.ifsc.replace(/\s/g, "").toUpperCase()}`;
}
export interface FraudExpense {
  readonly id: string;
  readonly amountPaise: Paise;
  readonly requesterId: PseudonymId;
  readonly payeeKey: string;
  readonly at: string;
  readonly invoiceNumber?: string;
  readonly evidenceHashes?: readonly string[];
}
export interface FraudPolicy {
  readonly newPayeeFirstPaymentPaise: Paise;
  readonly largeExpensePaise: Paise;
  readonly coolingOffHours: number;
  readonly splitWindowHours: number;
  readonly approvalThresholdPaise: Paise;
  readonly velocityWindowHours: number;
  readonly velocityMaxPaise: Paise;
  readonly blockedFlagCodes: readonly FraudFlagCode[];
}
export const DEFAULT_FRAUD_POLICY: FraudPolicy = {
  newPayeeFirstPaymentPaise: paise(100_000),
  largeExpensePaise: paise(500_000),
  coolingOffHours: 24,
  splitWindowHours: 24,
  approvalThresholdPaise: paise(1_000_000),
  velocityWindowHours: 24,
  velocityMaxPaise: paise(2_000_000),
  blockedFlagCodes: ["self_payment", "duplicate_invoice", "duplicate_evidence"],
};
export type FraudFlagCode =
  | "new_payee_large_first_payment"
  | "payee_changed_cooling_off"
  | "self_payment"
  | "split_requests"
  | "duplicate_invoice"
  | "duplicate_evidence"
  | "gstin_name_mismatch"
  | "payee_velocity";
export interface FraudFlag {
  readonly code: FraudFlagCode;
  readonly reason: string;
}
export interface FraudAcknowledgement {
  readonly code: FraudFlagCode;
  readonly actorPseudonym: PseudonymId;
  readonly reason: string;
  readonly acknowledgedAt: string;
}
export function hasUnacknowledgedBlockingFlags(
  flags: readonly FraudFlag[],
  acknowledgements: readonly FraudAcknowledgement[],
  policy: FraudPolicy = DEFAULT_FRAUD_POLICY,
): boolean {
  return flags.some(
    (flag) =>
      policy.blockedFlagCodes.includes(flag.code) &&
      !acknowledgements.some((ack) => ack.code === flag.code && ack.reason.trim().length > 0),
  );
}
export interface FraudEvidenceStore {
  hasInvoice(payeeKey: string, invoiceNumber: string): Promise<boolean>;
  hasEvidenceHash(hash: string): Promise<boolean>;
}
export interface ExistingFraudEvidence {
  readonly invoiceAlreadyUsed: boolean;
  readonly evidenceHashesAlreadyUsed: readonly string[];
}
export interface FraudEvaluationInput {
  readonly expense: FraudExpense;
  readonly priorExpenses: readonly FraudExpense[];
  readonly isFirstPaymentToPayee: boolean;
  readonly changedPayeeAt?: string;
  readonly memberAndRequesterPayeeKeys: readonly string[];
  readonly declaredGstin?: string;
  readonly payeeName?: string;
  readonly gstinRegisteredName?: string;
  readonly existingEvidence?: ExistingFraudEvidence;
  readonly policy?: FraudPolicy;
}
export function evaluatePayeeFraud(input: FraudEvaluationInput): readonly FraudFlag[] {
  const p = input.policy ?? DEFAULT_FRAUD_POLICY;
  const e = input.expense;
  const flags: FraudFlag[] = [];
  const add = (code: FraudFlagCode, reason: string) => {
    if (!flags.some((f) => f.code === code)) flags.push({ code, reason });
  };
  const history = input.priorExpenses.filter((x) => x.payeeKey === e.payeeKey);
  if (input.isFirstPaymentToPayee && e.amountPaise >= p.newPayeeFirstPaymentPaise)
    add(
      "new_payee_large_first_payment",
      "First payment to this payee exceeds the configured limit.",
    );
  if (
    input.changedPayeeAt &&
    e.amountPaise >= p.largeExpensePaise &&
    Date.parse(e.at) - Date.parse(input.changedPayeeAt) < p.coolingOffHours * 3_600_000
  )
    add("payee_changed_cooling_off", "Payee changed too soon before a large expense.");
  if (input.memberAndRequesterPayeeKeys.includes(e.payeeKey))
    add("self_payment", "Payee matches a fund member or the requester.");
  const split = [...history, e]
    .filter((x) => Math.abs(Date.parse(e.at) - Date.parse(x.at)) <= p.splitWindowHours * 3_600_000)
    .reduce((n, x) => n + x.amountPaise, 0);
  if (split > p.approvalThresholdPaise && e.amountPaise < p.approvalThresholdPaise)
    add(
      "split_requests",
      "Several requests to this payee exceed the approval threshold in the configured window.",
    );
  if (input.declaredGstin) {
    const gstin = input.declaredGstin.trim().toUpperCase();
    if (!isValidGstinFormat(gstin) || !validateGstinChecksum(gstin)) {
      add("gstin_name_mismatch", "Declared GSTIN is invalid.");
    } else if (
      input.payeeName &&
      input.gstinRegisteredName &&
      normalizeName(input.payeeName) !== normalizeName(input.gstinRegisteredName)
    ) {
      add(
        "gstin_name_mismatch",
        "Payee name does not match the name registered to the declared GSTIN.",
      );
    }
  }
  const velocity = [...history, e]
    .filter(
      (x) =>
        Date.parse(e.at) - Date.parse(x.at) >= 0 &&
        Date.parse(e.at) - Date.parse(x.at) <= p.velocityWindowHours * 3_600_000,
    )
    .reduce((n, x) => n + x.amountPaise, 0);
  if (velocity > p.velocityMaxPaise)
    add("payee_velocity", "Payee spending exceeds the configured velocity limit.");
  if (e.invoiceNumber && input.existingEvidence?.invoiceAlreadyUsed)
    add("duplicate_invoice", "Invoice number was used on another expense.");
  if (
    (e.evidenceHashes ?? []).some((hash) =>
      input.existingEvidence?.evidenceHashesAlreadyUsed.includes(hash),
    )
  )
    add("duplicate_evidence", "Evidence hash was used on another expense.");
  return flags;
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

/** Read-only adapter; all I/O happens before the pure rule evaluator is called. */
export async function loadExistingFraudEvidence(
  expense: FraudExpense,
  store: FraudEvidenceStore,
): Promise<ExistingFraudEvidence> {
  const invoiceAlreadyUsed = expense.invoiceNumber
    ? await store.hasInvoice(expense.payeeKey, expense.invoiceNumber)
    : false;
  const evidenceHashesAlreadyUsed: string[] = [];
  for (const hash of expense.evidenceHashes ?? []) {
    if (await store.hasEvidenceHash(hash)) evidenceHashesAlreadyUsed.push(hash);
  }
  return { invoiceAlreadyUsed, evidenceHashesAlreadyUsed };
}
