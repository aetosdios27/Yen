import { uuidv7 } from "@yen/db";
import type { PseudonymId } from "@yen/eventlog";
import { type Paise, paise } from "@yen/shared";
import {
  type ApprovalProofVerifier,
  DuplicateApprovalError,
  type ExpenseEvidence,
  ExpenseNotEditableError,
  type ExpenseRequest,
  type ExpenseStatus,
  type FundPolicy,
  InvalidPasskeySignatureError,
  InvalidStateTransitionError,
  SeparationOfDutiesError,
  type SignedApproval,
} from "./types.js";

const VALID_TRANSITIONS: ReadonlyMap<ExpenseStatus, ReadonlySet<ExpenseStatus>> = new Map([
  ["draft", new Set(["submitted"])],
  ["submitted", new Set(["approved", "rejected", "expired"])],
  ["approved", new Set(["paid"])],
  ["paid", new Set(["reconciled"])],
  ["rejected", new Set()],
  ["expired", new Set()],
  ["reconciled", new Set()],
]);

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return Boolean(allowed?.has(to));
}

export function assertValidTransition(from: ExpenseStatus, to: ExpenseStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export interface CreateDraftInput {
  readonly id?: string | undefined;
  readonly fundId: string;
  readonly requesterId: PseudonymId;
  readonly amountPaise: Paise;
  readonly description: string;
  readonly recipientRef: string;
  readonly evidence?: readonly ExpenseEvidence[] | undefined;
  readonly supersedesId?: string | null | undefined;
  readonly createdAt?: string | undefined;
}

export function createDraftRequest(input: CreateDraftInput): ExpenseRequest {
  const paiseAmount = paise(Number(input.amountPaise));
  if (paiseAmount <= 0) {
    throw new RangeError("Expense amount must be positive paise");
  }
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? uuidv7(),
    fundId: input.fundId,
    requesterId: input.requesterId,
    amountPaise: paiseAmount,
    description: input.description,
    recipientRef: input.recipientRef,
    status: "draft",
    holdId: null,
    approvals: [],
    evidence: input.evidence ?? [],
    supersedesId: input.supersedesId ?? null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    objectionEndsAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: null,
    reconciledAt: null,
    bankTransactionId: null,
    expiresAt: null,
  };
}

export interface EditDraftInput {
  readonly amountPaise?: Paise | undefined;
  readonly description?: string | undefined;
  readonly recipientRef?: string | undefined;
  readonly evidence?: readonly ExpenseEvidence[] | undefined;
  readonly updatedAt?: string | undefined;
}

export function editDraftRequest(expense: ExpenseRequest, updates: EditDraftInput): ExpenseRequest {
  if (expense.status !== "draft") {
    throw new ExpenseNotEditableError();
  }
  const amount =
    updates.amountPaise !== undefined ? paise(Number(updates.amountPaise)) : expense.amountPaise;
  if (amount <= 0) {
    throw new RangeError("Expense amount must be positive paise");
  }

  const now = updates.updatedAt ?? new Date().toISOString();
  return {
    ...expense,
    amountPaise: amount,
    description: updates.description ?? expense.description,
    recipientRef: updates.recipientRef ?? expense.recipientRef,
    evidence: updates.evidence ?? expense.evidence,
    updatedAt: now,
  };
}

export function createNewVersion(
  submittedExpense: ExpenseRequest,
  updates: EditDraftInput,
  requesterId?: PseudonymId,
): ExpenseRequest {
  return createDraftRequest({
    fundId: submittedExpense.fundId,
    requesterId: requesterId ?? submittedExpense.requesterId,
    amountPaise: updates.amountPaise ?? submittedExpense.amountPaise,
    description: updates.description ?? submittedExpense.description,
    recipientRef: updates.recipientRef ?? submittedExpense.recipientRef,
    evidence: updates.evidence ?? submittedExpense.evidence,
    supersedesId: submittedExpense.id,
    createdAt: updates.updatedAt,
  });
}

export interface SubmitExpenseOptions {
  readonly holdId: string;
  readonly policy: FundPolicy;
  readonly nowUtc?: string;
}

export function submitExpense(
  expense: ExpenseRequest,
  options: SubmitExpenseOptions,
): ExpenseRequest {
  assertValidTransition(expense.status, "submitted");

  const now = options.nowUtc ?? new Date().toISOString();
  const nowMs = Date.parse(now);

  const objectionEndsAt =
    options.policy.objectionWindowHours > 0
      ? new Date(nowMs + options.policy.objectionWindowHours * 3600_000).toISOString()
      : null;

  const expiresAt =
    options.policy.autoExpireHours > 0
      ? new Date(nowMs + options.policy.autoExpireHours * 3600_000).toISOString()
      : null;

  return {
    ...expense,
    status: "submitted",
    holdId: options.holdId,
    submittedAt: now,
    objectionEndsAt,
    expiresAt,
    updatedAt: now,
  };
}

export function getRequiredQuorum(amountPaise: Paise, policy: FundPolicy): number {
  if (policy.amountThresholds && policy.amountThresholds.length > 0) {
    for (const threshold of policy.amountThresholds) {
      if (amountPaise <= threshold.maxPaise) {
        return threshold.quorum;
      }
    }
  }
  return policy.approvalQuorum;
}

export interface AddApprovalResult {
  readonly expense: ExpenseRequest;
  readonly reachedQuorum: boolean;
}

export function addSignedApproval(
  expense: ExpenseRequest,
  approval: SignedApproval,
  policy: FundPolicy,
  verifyApprovalProof: ApprovalProofVerifier,
  nowUtc?: string,
): AddApprovalResult {
  if (expense.status !== "submitted") {
    throw new InvalidStateTransitionError(
      expense.status,
      "approved",
      `Cannot approve expense in status "${expense.status}"; must be "submitted"`,
    );
  }

  // Separation of duties
  if (approval.approverId === expense.requesterId) {
    throw new SeparationOfDutiesError();
  }

  // Deduplication
  if (expense.approvals.some((a) => a.approverId === approval.approverId)) {
    throw new DuplicateApprovalError();
  }

  if (!verifyApprovalProof(approval.passkeySignature, expense)) {
    throw new InvalidPasskeySignatureError();
  }

  const now = nowUtc ?? new Date().toISOString();
  const newApprovals = [...expense.approvals, approval];
  const requiredQuorum = getRequiredQuorum(expense.amountPaise, policy);

  // Check objection window
  const nowMs = Date.parse(now);
  const objectionActive =
    expense.objectionEndsAt !== null && nowMs < Date.parse(expense.objectionEndsAt);

  if (objectionActive) {
    // Record the approval, but cannot reach quorum until objection window ends
    return {
      expense: {
        ...expense,
        approvals: newApprovals,
        updatedAt: now,
      },
      reachedQuorum: false,
    };
  }

  if (newApprovals.length >= requiredQuorum) {
    return {
      expense: {
        ...expense,
        status: "approved",
        approvals: newApprovals,
        approvedAt: now,
        updatedAt: now,
      },
      reachedQuorum: true,
    };
  }

  return {
    expense: {
      ...expense,
      approvals: newApprovals,
      updatedAt: now,
    },
    reachedQuorum: false,
  };
}

export function evaluateObjectionWindow(
  expense: ExpenseRequest,
  policy: FundPolicy,
  nowUtc?: string,
): { expense: ExpenseRequest; transitioned: boolean } {
  if (expense.status !== "submitted") {
    return { expense, transitioned: false };
  }
  const now = nowUtc ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const objectionActive =
    expense.objectionEndsAt !== null && nowMs < Date.parse(expense.objectionEndsAt);

  if (objectionActive) {
    return { expense, transitioned: false };
  }

  const requiredQuorum = getRequiredQuorum(expense.amountPaise, policy);
  if (expense.approvals.length >= requiredQuorum) {
    return {
      expense: {
        ...expense,
        status: "approved",
        approvedAt: now,
        updatedAt: now,
      },
      transitioned: true,
    };
  }

  return { expense, transitioned: false };
}

export function rejectExpense(
  expense: ExpenseRequest,
  reason: "quorum" | "objection" | "policy",
  nowUtc?: string,
): ExpenseRequest {
  assertValidTransition(expense.status, "rejected");
  const now = nowUtc ?? new Date().toISOString();
  return {
    ...expense,
    status: "rejected",
    rejectedAt: now,
    rejectionReason: reason,
    updatedAt: now,
  };
}

export function expireExpense(expense: ExpenseRequest, nowUtc?: string): ExpenseRequest {
  assertValidTransition(expense.status, "expired");
  const now = nowUtc ?? new Date().toISOString();
  return {
    ...expense,
    status: "expired",
    expiredAt: now,
    updatedAt: now,
  };
}

export function payExpense(
  expense: ExpenseRequest,
  bankTransactionId: string,
  nowUtc?: string,
): ExpenseRequest {
  assertValidTransition(expense.status, "paid");
  const now = nowUtc ?? new Date().toISOString();
  return {
    ...expense,
    status: "paid",
    paidAt: now,
    bankTransactionId,
    updatedAt: now,
  };
}

export function reconcileExpense(
  expense: ExpenseRequest,
  bankTransactionId: string,
  nowUtc?: string,
): ExpenseRequest {
  assertValidTransition(expense.status, "reconciled");
  const now = nowUtc ?? new Date().toISOString();
  return {
    ...expense,
    status: "reconciled",
    reconciledAt: now,
    bankTransactionId: expense.bankTransactionId ?? bankTransactionId,
    updatedAt: now,
  };
}
