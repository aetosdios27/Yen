"use client";

import { formatInr, type Paise } from "@yen/shared";
import { useI18n } from "../i18n";
import { cn } from "./cn";
import { CheckCircleIcon, ClockIcon, XCircleIcon } from "./icons";

export type ExpenseTimelineStatus =
  | "draft"
  | "submitted"
  | "hold_reserved"
  | "approved"
  | "settled"
  | "rejected"
  | "expired";

export interface ExpenseTimelineApproval {
  readonly approverId: string;
  readonly approverName?: string | undefined;
  readonly approvedAt: string;
}

export interface ExpenseTimelineProps {
  readonly status: ExpenseTimelineStatus;
  readonly amountPaise: Paise;
  readonly payeeName: string;
  readonly createdAt: string;
  readonly submittedAt?: string | undefined;
  readonly holdReservedAt?: string | undefined;
  readonly approvals?: readonly ExpenseTimelineApproval[] | undefined;
  readonly approvalsCount?: number | undefined;
  readonly requiredQuorum?: number | undefined;
  readonly settledAt?: string | undefined;
  readonly rejectedAt?: string | undefined;
  readonly rejectionReason?: string | undefined;
  readonly expiredAt?: string | undefined;
  readonly className?: string | undefined;
}

interface StepItem {
  id: string;
  title: string;
  description: string;
  timestamp?: string | undefined;
  state: "completed" | "current" | "pending" | "rejected";
}

export function ExpenseTimeline({
  status,
  amountPaise,
  payeeName,
  createdAt,
  submittedAt,
  holdReservedAt,
  approvals = [],
  approvalsCount,
  requiredQuorum = 2,
  settledAt,
  rejectedAt,
  rejectionReason,
  expiredAt,
  className,
}: ExpenseTimelineProps) {
  const { t } = useI18n();

  const isRejected = status === "rejected";
  const isExpired = status === "expired";
  const isSettled = status === "settled";
  const isSubmitted = status !== "draft" || submittedAt !== undefined;
  const isHoldActive = isSubmitted && (holdReservedAt !== undefined || status !== "draft");

  const approvedCount = approvalsCount ?? approvals.length;
  const quorumMet = approvedCount >= requiredQuorum;

  const steps: StepItem[] = [
    {
      id: "step-draft",
      title: t("expenseTimeline.stateDraft"),
      description: t("expenseTimeline.stateDraftDesc"),
      timestamp: createdAt,
      state: "completed",
    },
    {
      id: "step-submitted",
      title: t("expenseTimeline.stateSubmitted"),
      description: t("expenseTimeline.stateSubmittedDesc"),
      timestamp: submittedAt ?? (isSubmitted ? createdAt : undefined),
      state: isSubmitted ? "completed" : "pending",
    },
    {
      id: "step-hold",
      title: t("expenseTimeline.stateHold"),
      description: `${t("expenseTimeline.stateHoldDesc")} (${formatInr(amountPaise)})`,
      timestamp: holdReservedAt ?? (isHoldActive ? (submittedAt ?? createdAt) : undefined),
      state: isHoldActive ? "completed" : "pending",
    },
    {
      id: "step-approvals",
      title: t("expenseTimeline.stateApprovals", {
        approved: String(approvedCount),
        quorum: String(requiredQuorum),
      }),
      description: t("expenseTimeline.stateApprovalsDesc", {
        approved: String(approvedCount),
        quorum: String(requiredQuorum),
      }),
      state: isRejected
        ? "rejected"
        : quorumMet
          ? "completed"
          : approvedCount > 0
            ? "current"
            : isSubmitted
              ? "current"
              : "pending",
    },
  ];

  if (isRejected) {
    steps.push({
      id: "step-outcome",
      title: t("expenseTimeline.stateRejected"),
      description: t("expenseTimeline.stateRejectedDesc", {
        reason: rejectionReason ?? "No reason provided",
      }),
      timestamp: rejectedAt,
      state: "rejected",
    });
  } else if (isExpired) {
    steps.push({
      id: "step-outcome",
      title: t("expenseTimeline.stateExpired"),
      description: t("expenseTimeline.stateExpiredDesc"),
      timestamp: expiredAt,
      state: "rejected",
    });
  } else {
    steps.push({
      id: "step-outcome",
      title: t("expenseTimeline.stateSettled"),
      description: t("expenseTimeline.stateSettledDesc", { payee: payeeName }),
      timestamp: settledAt,
      state: isSettled ? "completed" : "pending",
    });
  }

  return (
    <div className={cn("rounded-card border border-border bg-surface p-4", className)}>
      <h3 className="mb-4 text-title font-semibold text-ink">{t("expenseTimeline.title")}</h3>
      <ol aria-label={t("expenseTimeline.title")} className="flex flex-col">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;

          return (
            <li key={step.id} className="flex gap-3">
              <div aria-hidden="true" className="flex w-6 shrink-0 flex-col items-center">
                {step.state === "completed" && (
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 text-verified-ink" />
                )}
                {step.state === "current" && (
                  <ClockIcon className="mt-0.5 h-5 w-5 text-pending-ink" />
                )}
                {step.state === "pending" && (
                  <span className="mt-1 h-3.5 w-3.5 rounded-full border-2 border-border-strong bg-canvas" />
                )}
                {step.state === "rejected" && (
                  <XCircleIcon className="mt-0.5 h-5 w-5 text-rejected-ink" />
                )}
                {isLast ? null : (
                  <span
                    className={cn(
                      "mt-1.5 min-h-[24px] w-0.5 flex-1",
                      step.state === "completed" ? "bg-verified-border" : "bg-border",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 flex-1 break-words", isLast ? "pb-0" : "pb-5")}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="text-body font-semibold text-ink">{step.title}</p>
                  {step.timestamp ? (
                    <time dateTime={step.timestamp} className="text-small text-ink-muted">
                      {step.timestamp}
                    </time>
                  ) : null}
                </div>
                <p className="mt-0.5 text-small text-ink-muted">{step.description}</p>

                {step.id === "step-approvals" && approvals.length > 0 && (
                  <ul
                    aria-label="Recorded approvals"
                    className="mt-2 space-y-1 rounded border border-border-strong/40 bg-canvas p-2 text-small text-ink"
                  >
                    {approvals.map((approval) => (
                      <li
                        key={approval.approverId}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="font-medium">
                          {approval.approverName ?? approval.approverId}
                        </span>
                        <time dateTime={approval.approvedAt} className="text-small text-ink-muted">
                          {approval.approvedAt}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
