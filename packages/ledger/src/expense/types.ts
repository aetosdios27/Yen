import type { PseudonymId } from "@yen/eventlog";
import type { FraudAcknowledgement, FraudFlag, Payee } from "@yen/policy";

export type { PseudonymId };

import type { Paise } from "@yen/shared";

export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired"
  | "paid"
  | "reconciled";

export const expenseCategories = [
  "Equipment",
  "Travel",
  "Catering",
  "Logistics",
  "Facilities",
  "Other",
] as const;

export type ExpenseCategory = (typeof expenseCategories)[number];

export interface PasskeySignatureData {
  readonly credentialId: string;
  readonly signatureHex: string;
  readonly clientDataJson: string;
  readonly authenticatorDataHex: string;
}

export interface SignedApproval {
  readonly approverId: PseudonymId;
  readonly passkeySignature: PasskeySignatureData;
  readonly approvedAt: string;
  readonly deviceSignaturePresent?: boolean;
  readonly credentialIdHash?: string;
}

export type ApprovalProofVerifier = (
  signature: PasskeySignatureData,
  expense: Pick<ExpenseRequest, "id" | "fundId" | "amountPaise">,
) => boolean;

export const rejectUnverifiedApprovalProof: ApprovalProofVerifier = () => false;

export interface ExpenseEvidence {
  readonly evidenceId: string;
  readonly contentSha256: string;
}

export interface ExpenseRequest {
  readonly id: string;
  readonly fundId: string;
  readonly requesterId: PseudonymId;
  readonly amountPaise: Paise;
  readonly category?: ExpenseCategory | undefined;
  readonly description: string;
  readonly recipientRef: string;
  readonly payee: Payee | null;
  readonly payeeFingerprint: string | null;
  readonly lastPayeeChangedAt: string | null;
  readonly fraudEvaluationId: string | null;
  readonly fraudFlags: readonly FraudFlag[];
  readonly fraudAcknowledgements: readonly FraudAcknowledgement[];
  readonly invoiceNumber?: string | undefined;
  readonly status: ExpenseStatus;
  readonly holdId: string | null;
  readonly approvals: readonly SignedApproval[];
  readonly evidence: readonly ExpenseEvidence[];
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  readonly objectionEndsAt: string | null;
  readonly approvedAt: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: "quorum" | "objection" | "policy" | null;
  readonly expiredAt: string | null;
  readonly paidAt: string | null;
  readonly reconciledAt: string | null;
  readonly bankTransactionId: string | null;
  readonly expiresAt: string | null;
}

export interface AmountThreshold {
  readonly maxPaise: Paise;
  readonly quorum: number;
}

export interface FundPolicy {
  readonly approvalQuorum: number;
  readonly objectionWindowHours: number;
  readonly autoExpireHours: number;
  readonly amountThresholds?: readonly AmountThreshold[];
  readonly requireDeviceSignatureAbove?: Paise | null;
}

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly fromStatus: ExpenseStatus,
    public readonly toStatus: ExpenseStatus,
    message?: string,
  ) {
    super(
      message ??
        `Illegal state transition from "${fromStatus}" to "${toStatus}" for expense request`,
    );
    this.name = "InvalidStateTransitionError";
  }
}

export class SeparationOfDutiesError extends Error {
  constructor(message = "Requester cannot approve their own expense request") {
    super(message);
    this.name = "SeparationOfDutiesError";
  }
}

export class DuplicateApprovalError extends Error {
  constructor(message = "Approver has already approved this expense request") {
    super(message);
    this.name = "DuplicateApprovalError";
  }
}

export class ExpenseNotEditableError extends Error {
  constructor(
    message = "Request cannot be edited after submission (new version = new request, linked)",
  ) {
    super(message);
    this.name = "ExpenseNotEditableError";
  }
}

export class InvalidPasskeySignatureError extends Error {
  constructor(message = "Passkey signature is not bound to this expense request") {
    super(message);
    this.name = "InvalidPasskeySignatureError";
  }
}

export class BankTransactionMismatchError extends Error {
  constructor() {
    super("Reconciliation bank transaction does not match the paid expense");
    this.name = "BankTransactionMismatchError";
  }
}

export class ObjectionWindowActiveError extends Error {
  constructor(message = "Cannot approve while objection window is active") {
    super(message);
    this.name = "ObjectionWindowActiveError";
  }
}

export class ExpenseNotFoundError extends Error {
  constructor(expenseId: string) {
    super(`Expense request ${expenseId} not found`);
    this.name = "ExpenseNotFoundError";
  }
}

export class UnacknowledgedFraudFlagsError extends Error {
  constructor() {
    super("Blocking payee fraud flags require an owner acknowledgement before approval");
    this.name = "UnacknowledgedFraudFlagsError";
  }
}

export class FraudAcknowledgementConflictError extends Error {
  constructor() {
    super("An existing payee fraud acknowledgement cannot be replaced or removed");
    this.name = "FraudAcknowledgementConflictError";
  }
}
