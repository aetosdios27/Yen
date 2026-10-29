import { type Paise, paise } from "@yen/shared";
import type { ValidatedExpenseSubmission } from "../components/expense-form";
import type {
  ExpenseTimelineApproval,
  ExpenseTimelineStatus,
} from "../components/expense-timeline";
import { getApiClient } from "./api-client";

export interface DashboardExpenseItem {
  readonly id: string;
  readonly fundId: string;
  readonly amountPaise: Paise;
  readonly payeeName: string;
  readonly payeeUpi: string;
  readonly purpose: string;
  readonly receiptRef?: string | undefined;
  readonly status: ExpenseTimelineStatus;
  readonly requesterId: string;
  readonly requesterName: string;
  readonly createdAt: string;
  readonly submittedAt?: string | undefined;
  readonly holdReservedAt?: string | undefined;
  readonly approvals: readonly ExpenseTimelineApproval[];
  readonly approvalsCount?: number | undefined;
  readonly requiredQuorum: number;
  readonly settledAt?: string | undefined;
  readonly rejectedAt?: string | undefined;
  readonly rejectionReason?: string | undefined;
}

export interface FundTreasurerData {
  readonly fundId: string;
  readonly fundName: string;
  readonly totalBalancePaise: Paise;
  readonly spendableBalancePaise: Paise;
  readonly pendingExpenses: readonly DashboardExpenseItem[];
}

export function toDashboardExpenseItem(exp: {
  id: string;
  fundId: string;
  amountPaise: string | number | bigint;
  description?: string;
  recipientRef?: string;
  status: string;
  holdId?: string | null;
  approvalsCount?: number;
  approvals?: readonly { approverId: string; approverName?: string; approvedAt: string }[];
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: "quorum" | "objection" | "policy" | string | null;
  paidAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  requesterId?: string;
  evidence?: readonly { evidenceId: string }[];
}): DashboardExpenseItem {
  let payeeName = exp.recipientRef ?? "Payee";
  let payeeUpi = "";
  const match = exp.recipientRef?.match(/^(.*?)\s*\(([^)]+@[^)]+)\)$/);
  if (match) {
    payeeName = match[1]?.trim() ?? payeeName;
    payeeUpi = match[2]?.trim() ?? "";
  }

  const rawStatus = exp.status;
  let status: ExpenseTimelineStatus = "draft";
  if (rawStatus === "submitted" || rawStatus === "hold_reserved") {
    status = "submitted";
  } else if (rawStatus === "approved") {
    status = "approved";
  } else if (rawStatus === "settled" || rawStatus === "paid" || rawStatus === "reconciled") {
    status = "settled";
  } else if (rawStatus === "rejected") {
    status = "rejected";
  } else if (rawStatus === "expired") {
    status = "expired";
  }

  const approvals: readonly ExpenseTimelineApproval[] = exp.approvals
    ? exp.approvals.map((a) => ({
        approverId: a.approverId,
        approverName: a.approverName,
        approvedAt: a.approvedAt,
      }))
    : [];

  return {
    id: exp.id,
    fundId: exp.fundId,
    amountPaise: paise(Number(exp.amountPaise)),
    payeeName,
    payeeUpi,
    purpose: exp.description ?? "",
    receiptRef: exp.evidence?.[0]?.evidenceId ? exp.evidence[0].evidenceId : undefined,
    status,
    requesterId: exp.requesterId ?? "requester",
    requesterName: "Treasurer",
    createdAt: exp.createdAt ?? new Date().toISOString(),
    submittedAt: exp.submittedAt ?? undefined,
    holdReservedAt: exp.holdId ? (exp.submittedAt ?? undefined) : undefined,
    approvals,
    approvalsCount: exp.approvalsCount ?? approvals.length,
    requiredQuorum: 2,
    settledAt: exp.paidAt ?? undefined,
    rejectedAt: exp.rejectedAt ?? undefined,
    rejectionReason: exp.rejectionReason ?? undefined,
  };
}

export async function fetchFundTreasurerData(fundId: string): Promise<FundTreasurerData> {
  const client = getApiClient();
  const [summaryRes, expensesRes] = await Promise.all([
    client.GET("/v1/funds/{fundId}/public/summary", { params: { path: { fundId } } }),
    client.GET("/v1/funds/{fundId}/expenses", { params: { path: { fundId } } }),
  ]);

  if (summaryRes.error) {
    throw new Error(summaryRes.error?.error?.message ?? "Could not load fund summary");
  }
  if (expensesRes.error) {
    throw new Error(expensesRes.error?.error?.message ?? "Could not load fund expenses");
  }

  const allExpenses = (expensesRes.data ?? []).map(toDashboardExpenseItem);
  const pending = allExpenses.filter(
    (e) => e.status === "draft" || e.status === "submitted" || e.status === "hold_reserved",
  );

  const totalBalancePaise = summaryRes.data.raisedPaise
    ? paise(Number(summaryRes.data.raisedPaise))
    : paise(0);
  const heldPaise = pending.reduce((sum, e) => sum + e.amountPaise, 0);
  const spendableBalancePaise = paise(Math.max(0, totalBalancePaise - heldPaise));

  return {
    fundId,
    fundName: summaryRes.data.name ?? `Community Fund (${fundId})`,
    totalBalancePaise,
    spendableBalancePaise,
    pendingExpenses: pending,
  };
}

export async function createExpenseRequest(
  fundId: string,
  submission: ValidatedExpenseSubmission,
): Promise<DashboardExpenseItem> {
  const client = getApiClient();
  const recipientRef = submission.payeeUpi
    ? `${submission.payeeName} (${submission.payeeUpi})`
    : submission.payeeName;

  const createRes = await client.POST("/v1/funds/{fundId}/expenses", {
    params: {
      path: { fundId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: {
      amountPaise: String(submission.amountPaise),
      description: submission.purpose,
      recipientRef,
    },
  });

  if (createRes.error || !createRes.data) {
    throw new Error(createRes.error?.error?.message ?? "Failed to create expense request");
  }

  const submitRes = await client.POST("/v1/funds/{fundId}/expenses/{expenseId}/submit", {
    params: {
      path: { fundId, expenseId: createRes.data.id },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
  });

  const finalData = submitRes.data ?? createRes.data;
  return toDashboardExpenseItem(finalData);
}

export async function fetchExpenseItem(
  fundId: string,
  expenseId: string,
): Promise<DashboardExpenseItem | null> {
  const client = getApiClient();
  const res = await client.GET("/v1/funds/{fundId}/expenses/{expenseId}", {
    params: { path: { fundId, expenseId } },
  });
  if (res.data) {
    return toDashboardExpenseItem(res.data);
  }

  return null;
}

export async function submitExpenseApproval(
  fundId: string,
  expenseId: string,
  approvalToken: string,
): Promise<DashboardExpenseItem> {
  const client = getApiClient();
  const res = await client.POST("/v1/funds/{fundId}/expenses/{expenseId}/approve", {
    params: {
      path: { fundId, expenseId },
      header: {
        "Idempotency-Key": crypto.randomUUID(),
        "X-Approval-Token": approvalToken,
      },
    },
    body: {
      approvalToken,
    },
  });

  if (res.error || !res.data) {
    throw new Error(res.error?.error?.message ?? "Failed to approve expense");
  }

  const updated = await fetchExpenseItem(fundId, expenseId);
  if (updated) {
    if (res.data.status === "approved") {
      return {
        ...updated,
        status: "approved",
        approvalsCount: res.data.approvalsCount ?? updated.approvalsCount,
      };
    }
    return updated;
  }

  throw new Error(`Expense ${expenseId} could not be retrieved after approval`);
}

export async function submitExpenseRejection(
  fundId: string,
  expenseId: string,
  reason: string,
  approvalToken?: string,
): Promise<DashboardExpenseItem> {
  const client = getApiClient();
  const res = await client.POST("/v1/funds/{fundId}/expenses/{expenseId}/reject", {
    params: {
      path: { fundId, expenseId },
      header: {
        "Idempotency-Key": crypto.randomUUID(),
        ...(approvalToken ? { "X-Approval-Token": approvalToken } : {}),
      },
    },
    body: {
      reason: "policy",
      ...(approvalToken ? { approvalToken } : {}),
    },
  });

  if (res.error || !res.data) {
    throw new Error(res.error?.error?.message ?? "Failed to reject expense");
  }

  const updated = await fetchExpenseItem(fundId, expenseId);
  if (updated) {
    return {
      ...updated,
      status: "rejected",
      rejectedAt: res.data.rejectedAt,
      rejectionReason: res.data.reason ?? reason,
    };
  }

  throw new Error(`Expense ${expenseId} could not be retrieved after approval`);
}
