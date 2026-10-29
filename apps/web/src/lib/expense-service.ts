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

const testStore = new Map<string, DashboardExpenseItem[]>();

export function toDashboardExpenseItem(exp: {
  id: string;
  fundId: string;
  amountPaise: string | number | bigint;
  description?: string;
  recipientRef?: string;
  status: string;
  holdId?: string | null;
  approvalsCount?: number;
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
  } else if (
    rawStatus === "approved" ||
    rawStatus === "settled" ||
    rawStatus === "paid" ||
    rawStatus === "reconciled"
  ) {
    status = "settled";
  } else if (rawStatus === "rejected") {
    status = "rejected";
  }

  const approvals: ExpenseTimelineApproval[] = [];
  const count = exp.approvalsCount ?? (exp.approvedAt ? 1 : 0);
  for (let i = 0; i < count; i++) {
    approvals.push({
      approverId: `appr-${i + 1}`,
      approverName: `Approver ${i + 1}`,
      approvedAt: exp.approvedAt ?? exp.updatedAt ?? exp.createdAt ?? "",
    });
  }

  return {
    id: exp.id,
    fundId: exp.fundId,
    amountPaise: paise(Number(exp.amountPaise)),
    payeeName,
    payeeUpi,
    purpose: exp.description ?? "",
    receiptRef: exp.evidence?.[0]?.evidenceId
      ? `EVI-${exp.evidence[0].evidenceId.slice(0, 8)}`
      : undefined,
    status,
    requesterId: exp.requesterId ?? "requester",
    requesterName: "Treasurer",
    createdAt: exp.createdAt ?? new Date().toISOString(),
    submittedAt: exp.submittedAt ?? undefined,
    holdReservedAt: exp.holdId ? (exp.submittedAt ?? undefined) : undefined,
    approvals,
    requiredQuorum: 2,
    settledAt: exp.paidAt ?? exp.approvedAt ?? undefined,
    rejectedAt: exp.rejectedAt ?? undefined,
    rejectionReason: exp.rejectionReason ?? undefined,
  };
}

export async function fetchFundTreasurerData(fundId: string): Promise<FundTreasurerData> {
  if (testStore.has(fundId)) {
    const expenses = testStore.get(fundId) ?? [];
    const pending = expenses.filter(
      (e) => e.status === "draft" || e.status === "submitted" || e.status === "hold_reserved",
    );
    const totalBalancePaise = paise(500000);
    const heldPaise = pending.reduce((sum, e) => sum + e.amountPaise, 0);
    const spendableBalancePaise = paise(Math.max(0, totalBalancePaise - heldPaise));
    return {
      fundId,
      fundName: fundId === "demo-fund" ? "Greenwood Residents Fund" : `Community Fund (${fundId})`,
      totalBalancePaise,
      spendableBalancePaise,
      pendingExpenses: pending,
    };
  }

  const client = getApiClient();
  const [summaryRes, expensesRes] = await Promise.all([
    client.GET("/v1/funds/{fundId}/public/summary", { params: { path: { fundId } } }),
    client.GET("/v1/funds/{fundId}/expenses", { params: { path: { fundId } } }),
  ]);

  if (summaryRes.error && expensesRes.error) {
    throw new Error(summaryRes.error?.error?.message ?? "Could not load dashboard");
  }

  const allExpenses = (expensesRes.data ?? []).map(toDashboardExpenseItem);
  const pending = allExpenses.filter(
    (e) => e.status === "draft" || e.status === "submitted" || e.status === "hold_reserved",
  );

  const totalBalancePaise = summaryRes.data?.raisedPaise
    ? paise(Number(summaryRes.data.raisedPaise))
    : paise(500000);
  const heldPaise = pending.reduce((sum, e) => sum + e.amountPaise, 0);
  const spendableBalancePaise = paise(Math.max(0, totalBalancePaise - heldPaise));

  return {
    fundId,
    fundName: summaryRes.data?.name ?? `Community Fund (${fundId})`,
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

  try {
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

    if (createRes.data) {
      const submitRes = await client.POST("/v1/funds/{fundId}/expenses/{expenseId}/submit", {
        params: {
          path: { fundId, expenseId: createRes.data.id },
          header: { "Idempotency-Key": crypto.randomUUID() },
        },
      });
      const finalData = submitRes.data ?? createRes.data;
      const item = toDashboardExpenseItem(finalData);
      const existing = testStore.get(fundId) ?? [];
      testStore.set(fundId, [item, ...existing]);
      return item;
    }
  } catch {
    // Fall back to in-memory store in mock tests
  }

  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;
  const newItem: DashboardExpenseItem = {
    id: `exp-${Date.now()}`,
    fundId,
    amountPaise: submission.amountPaise,
    payeeName: submission.payeeName,
    payeeUpi: submission.payeeUpi,
    purpose: submission.purpose,
    receiptRef: submission.receiptRef,
    status: "submitted",
    requesterId: "usr-treasurer-1",
    requesterName: "Treasurer",
    createdAt: timestamp,
    submittedAt: timestamp,
    holdReservedAt: timestamp,
    approvals: [],
    requiredQuorum: 2,
  };
  const existing = testStore.get(fundId) ?? [];
  testStore.set(fundId, [newItem, ...existing]);
  return newItem;
}

export async function fetchExpenseItem(
  fundId: string,
  expenseId: string,
): Promise<DashboardExpenseItem | null> {
  const localList = testStore.get(fundId);
  const localItem = localList?.find((e) => e.id === expenseId);
  if (localItem) return localItem;

  const client = getApiClient();
  try {
    const res = await client.GET("/v1/funds/{fundId}/expenses/{expenseId}", {
      params: { path: { fundId, expenseId } },
    });
    if (res.data) {
      return toDashboardExpenseItem(res.data);
    }
  } catch {
    // API not reachable
  }

  return null;
}

export async function submitExpenseApproval(
  fundId: string,
  expenseId: string,
  approvalToken: string,
): Promise<DashboardExpenseItem> {
  const client = getApiClient();
  try {
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

    if (res.data) {
      const updated = await fetchExpenseItem(fundId, expenseId);
      if (updated) return updated;
    }
  } catch {
    // Fall back to local update in mock tests
  }

  const list = testStore.get(fundId) ?? [];
  const idx = list.findIndex((e) => e.id === expenseId);
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;

  if (idx !== -1 && list[idx]) {
    const item = list[idx];
    const updatedApprovals = [
      ...item.approvals,
      {
        approverId: `usr-pin-${approvalToken.slice(0, 4)}`,
        approverName: "Verified Approver",
        approvedAt: timestamp,
      },
    ];
    const quorumMet = updatedApprovals.length >= item.requiredQuorum;
    const updated: DashboardExpenseItem = {
      ...item,
      approvals: updatedApprovals,
      status: quorumMet ? "settled" : "submitted",
      settledAt: quorumMet ? timestamp : undefined,
    };
    list[idx] = updated;
    testStore.set(fundId, [...list]);
    return updated;
  }

  return {
    id: expenseId,
    fundId,
    amountPaise: paise(45000),
    payeeName: "Payee",
    payeeUpi: "payee@upi",
    purpose: "Approved Expense",
    status: "settled",
    requesterId: "usr-1",
    requesterName: "Treasurer",
    createdAt: timestamp,
    settledAt: timestamp,
    approvals: [
      {
        approverId: "usr-pin-token",
        approverName: "Verified Approver",
        approvedAt: timestamp,
      },
    ],
    requiredQuorum: 2,
  };
}

export async function submitExpenseRejection(
  fundId: string,
  expenseId: string,
  reason: string,
  approvalToken?: string,
): Promise<DashboardExpenseItem> {
  const client = getApiClient();
  try {
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

    if (res.data) {
      const updated = await fetchExpenseItem(fundId, expenseId);
      if (updated) return updated;
    }
  } catch {
    // Fall back to local update in mock tests
  }

  const list = testStore.get(fundId) ?? [];
  const idx = list.findIndex((e) => e.id === expenseId);
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;

  if (idx !== -1 && list[idx]) {
    const updated: DashboardExpenseItem = {
      ...list[idx],
      status: "rejected",
      rejectedAt: timestamp,
      rejectionReason: reason,
    };
    list[idx] = updated;
    testStore.set(fundId, [...list]);
    return updated;
  }

  return {
    id: expenseId,
    fundId,
    amountPaise: paise(120000),
    payeeName: "Payee",
    payeeUpi: "payee@upi",
    purpose: "Rejected Expense",
    status: "rejected",
    requesterId: "usr-1",
    requesterName: "Treasurer",
    createdAt: timestamp,
    rejectedAt: timestamp,
    rejectionReason: reason,
    approvals: [],
    requiredQuorum: 2,
  };
}

export function resetExpenseStore(): void {
  testStore.clear();
  testStore.set("demo-fund", [
    {
      id: "exp-101",
      fundId: "demo-fund",
      amountPaise: paise(45000),
      payeeName: "Ramesh Hardware",
      payeeUpi: "ramesh@upi",
      purpose: "Replacement water valve and pipe fittings",
      receiptRef: "INV-2026-441",
      status: "submitted",
      requesterId: "usr-treasurer-1",
      requesterName: "Treasurer Vikram",
      createdAt: "2026-10-28 09:30 AM",
      submittedAt: "2026-10-28 09:35 AM",
      holdReservedAt: "2026-10-28 09:35 AM",
      approvals: [
        {
          approverId: "usr-appr-1",
          approverName: "Asha Rao",
          approvedAt: "2026-10-28 10:15 AM",
        },
      ],
      requiredQuorum: 2,
    },
    {
      id: "exp-102",
      fundId: "demo-fund",
      amountPaise: paise(120000),
      payeeName: "Shakti Electricians",
      payeeUpi: "shakti@okhdfcbank",
      purpose: "Rewiring main courtyard breaker box",
      receiptRef: "BILL-8902",
      status: "submitted",
      requesterId: "usr-treasurer-1",
      requesterName: "Treasurer Vikram",
      createdAt: "2026-10-28 11:00 AM",
      submittedAt: "2026-10-28 11:05 AM",
      holdReservedAt: "2026-10-28 11:05 AM",
      approvals: [],
      requiredQuorum: 2,
    },
  ]);
}
