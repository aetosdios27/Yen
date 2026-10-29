import { createHmac, randomUUID } from "node:crypto";
import type { ExpenseRequest } from "@yen/ledger";
import {
  DEFAULT_FRAUD_POLICY,
  evaluatePayeeFraud,
  type FraudPolicy,
  loadExistingFraudEvidence,
  normalizePayeeKey,
} from "@yen/policy";
import type { EvidenceStore } from "../stores.js";
import type { PayeeProfileStore } from "./profile-store.js";

export function fingerprintPayee(
  fundId: string,
  identity: NonNullable<ExpenseRequest["payee"]>["identity"],
  salt: string,
): string {
  return createHmac("sha256", salt)
    .update(`yen/payee-fingerprint/v1\0${fundId}\0${normalizePayeeKey(identity)}`)
    .digest("hex");
}

export async function evaluateExpensePayeeRules(input: {
  readonly expense: ExpenseRequest;
  readonly priorExpenses: readonly ExpenseRequest[];
  readonly profileStore: PayeeProfileStore;
  readonly evidenceStore: EvidenceStore;
  readonly now: string;
  readonly policy?: FraudPolicy;
}): Promise<Pick<ExpenseRequest, "fraudEvaluationId" | "fraudFlags" | "fraudAcknowledgements">> {
  const { expense } = input;
  if (!expense.payee || !expense.payeeFingerprint) {
    throw new Error("Expense payee identity must be set before rule evaluation");
  }
  const activeProfileFingerprints = await input.profileStore.listActiveFingerprints(expense.fundId);
  const requesterFingerprint = await input.profileStore.getFingerprint(
    expense.fundId,
    expense.requesterId,
  );
  const requesterHasProfile =
    requesterFingerprint !== null &&
    (await input.profileStore.isActiveMember(expense.fundId, expense.requesterId));
  const requesterDisplayName = requesterHasProfile
    ? null
    : await input.profileStore.getMemberDisplayName(expense.fundId, expense.requesterId);
  const currentEvidence = await input.evidenceStore.getByExpense(expense.fundId, expense.id);
  const vendorEvidence = currentEvidence.find(
    (item) => item.vendorName || item.gstin || item.invoiceNumber,
  );
  const invoiceNumber = expense.invoiceNumber ?? vendorEvidence?.invoiceNumber;
  const ruleExpense = {
    id: expense.id,
    amountPaise: expense.amountPaise,
    requesterId: expense.requesterId,
    payeeKey: expense.payeeFingerprint,
    at: input.now,
    ...(invoiceNumber ? { invoiceNumber } : {}),
    evidenceHashes: expense.evidence.map((item) => item.contentSha256),
  };
  const history = input.priorExpenses.filter(
    (item) => item.id !== expense.id && item.payeeFingerprint !== null,
  );
  const existingEvidence = await loadExistingFraudEvidence(ruleExpense, {
    hasInvoice: async (payeeFingerprint, invoiceNumber) => {
      for (const prior of history) {
        if (prior.payeeFingerprint !== payeeFingerprint) continue;
        const priorEvidence = await input.evidenceStore.getByExpense(expense.fundId, prior.id);
        if (priorEvidence.some((item) => item.invoiceNumber === invoiceNumber)) return true;
      }
      return false;
    },
    hasEvidenceHash: async (hash) => {
      const matches = await input.evidenceStore.findBySha256(expense.fundId, hash);
      return matches.some((item) => item.expenseId !== expense.id);
    },
  });
  const paidToPayeeBefore = history.some(
    (item) =>
      item.payeeFingerprint === expense.payeeFingerprint &&
      (item.status === "paid" || item.status === "reconciled"),
  );
  const flags = evaluatePayeeFraud({
    expense: ruleExpense,
    priorExpenses: history.flatMap((item) =>
      item.payeeFingerprint
        ? [
            {
              id: item.id,
              amountPaise: item.amountPaise,
              requesterId: item.requesterId,
              payeeKey: item.payeeFingerprint,
              at: item.submittedAt ?? item.createdAt,
              ...(item.invoiceNumber ? { invoiceNumber: item.invoiceNumber } : {}),
              evidenceHashes: item.evidence.map((evidence) => evidence.contentSha256),
            },
          ]
        : [],
    ),
    isFirstPaymentToPayee: !paidToPayeeBefore,
    ...(expense.lastPayeeChangedAt ? { changedPayeeAt: expense.lastPayeeChangedAt } : {}),
    profileFingerprints: activeProfileFingerprints,
    requesterHasProfile,
    ...(requesterDisplayName ? { requesterDisplayName } : {}),
    ...(vendorEvidence?.gstin ? { declaredGstin: vendorEvidence.gstin } : {}),
    ...(expense.payee.gstin ? { payeeGstin: expense.payee.gstin } : {}),
    ...(vendorEvidence?.vendorName ? { invoiceVendorName: vendorEvidence.vendorName } : {}),
    payeeName: expense.payee.name,
    existingEvidence,
    policy: input.policy ?? DEFAULT_FRAUD_POLICY,
  });
  return {
    fraudEvaluationId: randomUUID(),
    fraudFlags: flags,
    fraudAcknowledgements: [],
  };
}
