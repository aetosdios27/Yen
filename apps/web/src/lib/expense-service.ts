import { type Paise, paise } from "@yen/shared";
import type { ValidatedExpenseSubmission } from "../components/expense-form";
import type {
  ExpenseTimelineApproval,
  ExpenseTimelineStatus,
} from "../components/expense-timeline";

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

const DEFAULT_DEMO_EXPENSES: Record<string, DashboardExpenseItem[]> = {
  "demo-fund": [
    {
      id: "exp-101",
      fundId: "demo-fund",
      amountPaise: paise(45000), // ₹450.00
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
      amountPaise: paise(120000), // ₹1,200.00
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
  ],
};

const memoryStore = new Map<string, DashboardExpenseItem[]>();

function getExpensesForFund(fundId: string): DashboardExpenseItem[] {
  const existing = memoryStore.get(fundId);
  if (existing) return existing;

  const initial = DEFAULT_DEMO_EXPENSES[fundId] ?? [
    {
      id: "exp-default-1",
      fundId,
      amountPaise: paise(50000),
      payeeName: "Community Supplies",
      payeeUpi: "supplies@upi",
      purpose: "Monthly water bottles and emergency supplies",
      receiptRef: "REC-01",
      status: "submitted",
      requesterId: "usr-treasurer-1",
      requesterName: "Treasurer",
      createdAt: "2026-10-28 10:00 AM",
      submittedAt: "2026-10-28 10:05 AM",
      holdReservedAt: "2026-10-28 10:05 AM",
      approvals: [],
      requiredQuorum: 2,
    },
  ];
  memoryStore.set(fundId, [...initial]);
  return memoryStore.get(fundId) ?? [];
}

export async function fetchFundTreasurerData(fundId: string): Promise<FundTreasurerData> {
  const expenses = getExpensesForFund(fundId);
  const pending = expenses.filter(
    (e) => e.status === "draft" || e.status === "submitted" || e.status === "hold_reserved",
  );

  const totalBalancePaise = paise(500000); // ₹5,000.00
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

export async function createExpenseRequest(
  fundId: string,
  submission: ValidatedExpenseSubmission,
): Promise<DashboardExpenseItem> {
  const expenses = getExpensesForFund(fundId);
  const now = new Date();
  const formattedTime = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const formattedDate = now.toISOString().split("T")[0] ?? "2026-10-28";
  const timestamp = `${formattedDate} ${formattedTime}`;

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

  memoryStore.set(fundId, [newItem, ...expenses]);
  return newItem;
}

export async function fetchExpenseItem(
  fundId: string,
  expenseId: string,
): Promise<DashboardExpenseItem | null> {
  const expenses = getExpensesForFund(fundId);
  const found = expenses.find((e) => e.id === expenseId);
  return found ?? null;
}

export async function submitExpenseApproval(
  fundId: string,
  expenseId: string,
  pin: string,
): Promise<DashboardExpenseItem> {
  const expenses = getExpensesForFund(fundId);
  const index = expenses.findIndex((e) => e.id === expenseId);
  if (index === -1) {
    throw new Error(`Expense ${expenseId} not found`);
  }

  const existing = expenses[index];
  if (!existing) {
    throw new Error(`Expense ${expenseId} not found`);
  }
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;

  const updatedApprovals = [
    ...existing.approvals,
    {
      approverId: `usr-pin-${pin.slice(0, 2)}`,
      approverName: "Verified Approver",
      approvedAt: timestamp,
    },
  ];

  const quorumMet = updatedApprovals.length >= existing.requiredQuorum;
  const newStatus: ExpenseTimelineStatus = quorumMet ? "settled" : "submitted";

  const updatedItem: DashboardExpenseItem = {
    ...existing,
    approvals: updatedApprovals,
    status: newStatus,
    settledAt: quorumMet ? timestamp : undefined,
  };

  expenses[index] = updatedItem;
  memoryStore.set(fundId, [...expenses]);
  return updatedItem;
}

export async function submitExpenseRejection(
  fundId: string,
  expenseId: string,
  reason: string,
): Promise<DashboardExpenseItem> {
  const expenses = getExpensesForFund(fundId);
  const index = expenses.findIndex((e) => e.id === expenseId);
  if (index === -1) {
    throw new Error(`Expense ${expenseId} not found`);
  }

  const existing = expenses[index];
  if (!existing) {
    throw new Error(`Expense ${expenseId} not found`);
  }
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;

  const updatedItem: DashboardExpenseItem = {
    ...existing,
    status: "rejected",
    rejectedAt: timestamp,
    rejectionReason: reason,
  };

  expenses[index] = updatedItem;
  memoryStore.set(fundId, [...expenses]);
  return updatedItem;
}

/** Utility to reset store for tests */
export function resetExpenseStore(): void {
  memoryStore.clear();
}
