"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApprovalPinModal } from "../../../../../components/approval-pin-modal";
import { Button } from "../../../../../components/button";
import { ExpenseTimeline } from "../../../../../components/expense-timeline";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "../../../../../components/icons";
import { Money } from "../../../../../components/money";
import { RejectionModal } from "../../../../../components/rejection-modal";
import { StatusBadge } from "../../../../../components/status-badge";
import { Toast } from "../../../../../components/toast";
import { useDocumentTitle, useI18n } from "../../../../../i18n";
import {
  type DashboardExpenseItem,
  fetchExpenseItem,
  submitExpenseApproval,
  submitExpenseRejection,
} from "../../../../../lib/expense-service";

export interface ApproverPageProps {
  params: Promise<{ fundId: string; expenseId: string }>;
}

export default function ApproverPage({ params }: ApproverPageProps) {
  const { t } = useI18n();
  useDocumentTitle("approver.title", "approver.fastDecisionNotice");

  const [ids, setIds] = useState<{ fundId: string; expenseId: string } | null>(null);
  const [expense, setExpense] = useState<DashboardExpenseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [isPinOpen, setIsPinOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    heading: string;
    description: string;
    tone: "success" | "warning";
  } | null>(null);

  useEffect(() => {
    Promise.resolve(params).then(setIds);
  }, [params]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const loadExpense = useCallback(async (fundId: string, expenseId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExpenseItem(fundId, expenseId);
      if (!result) {
        setError("Expense not found");
      } else {
        setExpense(result);
      }
    } catch {
      setError("Failed to load expense details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ids) {
      loadExpense(ids.fundId, ids.expenseId);
    }
  }, [ids, loadExpense]);

  const handleApproveWithPin = async (approvalToken: string) => {
    if (!ids) return;
    const updated = await submitExpenseApproval(ids.fundId, ids.expenseId, approvalToken);
    setExpense(updated);
    setIsPinOpen(false);
    setToastMessage({
      heading: t("approver.approvedSuccess"),
      description: `${updated.payeeName} · ${updated.purpose}`,
      tone: "success",
    });
  };

  const handleRejectWithReason = async (reason: string) => {
    if (!ids) return;
    const updated = await submitExpenseRejection(ids.fundId, ids.expenseId, reason);
    setExpense(updated);
    setIsRejectOpen(false);
    setToastMessage({
      heading: t("approver.rejectedSuccess"),
      description: `Reason: ${reason}`,
      tone: "warning",
    });
  };

  const isPending =
    expense !== null &&
    (expense.status === "draft" ||
      expense.status === "submitted" ||
      expense.status === "hold_reserved");
  const isSettled = expense?.status === "settled" || expense?.status === "approved";
  const isRejected = expense?.status === "rejected";

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 pb-28 sm:pb-8">
      {/* Toast Notification */}
      {toastMessage ? (
        <Toast
          title={toastMessage.heading}
          description={toastMessage.description}
          tone={toastMessage.tone}
          onClose={() => setToastMessage(null)}
        />
      ) : null}

      {/* Nav back */}
      <nav aria-label="Breadcrumb">
        <Link
          href={ids ? `/funds/${ids.fundId}/treasurer` : "/"}
          className="tap-target inline-flex items-center text-small font-semibold text-primary underline-offset-4 hover:underline"
        >
          ← {t("treasurer.title")}
        </Link>
      </nav>

      {/* Offline banner */}
      {isOffline ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-control border-2 border-unmatched-border bg-unmatched-bg p-3 text-small font-medium text-unmatched-ink"
        >
          <AlertTriangleIcon className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p>{t("treasurer.offlineNotice")}</p>
          </div>
          {ids ? (
            <button
              type="button"
              onClick={() => loadExpense(ids.fundId, ids.expenseId)}
              className="tap-target rounded px-2 text-small font-semibold underline underline-offset-4"
            >
              {t("treasurer.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Loading state */}
      {loading ? (
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-8 text-center"
        >
          <ClockIcon className="h-8 w-8 motion-safe:animate-spin text-primary" />
          <p className="text-body font-medium text-ink-muted">{t("common.loading")}...</p>
        </div>
      ) : error || !expense ? (
        /* Error / Not Found */
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-card border border-danger bg-surface p-6 text-center"
        >
          <AlertTriangleIcon className="h-10 w-10 text-danger" />
          <h1 className="text-title font-bold text-ink">{error ?? "Expense not found"}</h1>
          {ids ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => loadExpense(ids.fundId, ids.expenseId)}
            >
              {t("treasurer.retry")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Header & WhatsApp Fast-decision Landing notice */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small font-semibold uppercase tracking-wider text-primary">
                {t("approver.title")}
              </span>
              <StatusBadge status={isSettled ? "verified" : isRejected ? "rejected" : "pending"} />
            </div>
            <h1 className="sr-only">{t("approver.title")}</h1>
            <div className="flex items-baseline justify-between gap-3">
              <Money amount={expense.amountPaise} className="text-display" />
            </div>
            <div
              role="note"
              className="rounded-control border border-border bg-canvas px-3.5 py-2 text-small text-ink-muted"
            >
              {t("approver.fastDecisionNotice")}
            </div>
          </div>

          {/* Expense Summary Details */}
          <div className="rounded-card border border-border bg-surface p-5">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-small font-semibold text-ink-muted">{t("approver.payee")}</dt>
                <dd className="text-body font-bold text-ink">{expense.payeeName}</dd>
              </div>

              <div>
                <dt className="text-small font-semibold text-ink-muted">{t("approver.upiVpa")}</dt>
                <dd className="font-mono text-body font-medium text-ink">{expense.payeeUpi}</dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-small font-semibold text-ink-muted">{t("approver.purpose")}</dt>
                <dd className="text-body text-ink">{expense.purpose}</dd>
              </div>

              <div>
                <dt className="text-small font-semibold text-ink-muted">
                  {t("approver.requestedBy")}
                </dt>
                <dd className="text-small font-medium text-ink">
                  {expense.requesterName} ({expense.createdAt})
                </dd>
              </div>

              <div>
                <dt className="text-small font-semibold text-ink-muted">
                  {t("approver.receipts")}
                </dt>
                <dd className="text-small text-ink">
                  {expense.receiptRef ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                      📄 {expense.receiptRef}
                    </span>
                  ) : (
                    <span className="text-ink-muted">{t("approver.noReceipts")}</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Request Status & Timeline View */}
          <ExpenseTimeline
            status={expense.status}
            amountPaise={expense.amountPaise}
            payeeName={expense.payeeName}
            createdAt={expense.createdAt}
            submittedAt={expense.submittedAt}
            holdReservedAt={expense.holdReservedAt}
            approvals={expense.approvals}
            requiredQuorum={expense.requiredQuorum}
            settledAt={expense.settledAt}
            rejectedAt={expense.rejectedAt}
            rejectionReason={expense.rejectionReason}
          />

          {/* Already Decided Banners */}
          {isSettled ? (
            <div
              role="status"
              className="flex items-center gap-2.5 rounded-card border-2 border-verified-border bg-verified-bg p-4 font-semibold text-verified-ink"
            >
              <CheckCircleIcon className="h-6 w-6 shrink-0" />
              <span>{t("approver.alreadyApproved")}</span>
            </div>
          ) : isRejected ? (
            <div
              role="status"
              className="flex items-center gap-2.5 rounded-card border-2 border-rejected-border bg-rejected-bg p-4 font-semibold text-rejected-ink"
            >
              <XCircleIcon className="h-6 w-6 shrink-0" />
              <span>{t("approver.alreadyRejected")}</span>
            </div>
          ) : null}

          {/* Decision Action Bar (Mobile thumb zone sticky / Desktop standard) */}
          {isPending ? (
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 p-3.5 backdrop-blur-md sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
              <div className="mx-auto flex max-w-xl gap-3">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setIsPinOpen(true)}
                  className="flex-1 border-verified-border bg-verified-bg text-verified-ink hover:bg-verified-bg/80 hover:text-verified-ink"
                >
                  <CheckCircleIcon className="h-5 w-5 shrink-0" />
                  <span>{t("approver.approveCta")}</span>
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setIsRejectOpen(true)}
                  className="flex-1"
                >
                  <XCircleIcon className="h-5 w-5 shrink-0" />
                  <span>{t("approver.rejectCta")}</span>
                </Button>
              </div>
            </div>
          ) : null}

          {/* PIN Verification Modal */}
          <ApprovalPinModal
            isOpen={isPinOpen}
            onClose={() => setIsPinOpen(false)}
            onConfirm={handleApproveWithPin}
            amountPaise={expense.amountPaise}
            payeeName={expense.payeeName}
            fundId={ids?.fundId}
            targetId={ids?.expenseId}
            action="expense:approve"
          />

          {/* Rejection Reason Modal */}
          <RejectionModal
            isOpen={isRejectOpen}
            onClose={() => setIsRejectOpen(false)}
            onConfirm={handleRejectWithReason}
            amountPaise={expense.amountPaise}
            payeeName={expense.payeeName}
          />
        </>
      )}
    </section>
  );
}
