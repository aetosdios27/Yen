"use client";

import type { ReactNode } from "react";
import { type MessageKey, useI18n } from "../i18n";
import { cn } from "./cn";
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from "./icons";

export type Status = "verified" | "pending" | "unmatched" | "rejected";

const STATUS_STYLES: Record<Status, string> = {
  verified: "border-verified-border bg-verified-bg text-verified-ink",
  pending: "border-pending-border bg-pending-bg text-pending-ink",
  unmatched: "border-unmatched-border bg-unmatched-bg text-unmatched-ink",
  rejected: "border-rejected-border bg-rejected-bg text-rejected-ink",
};

const STATUS_MESSAGE_KEYS = {
  verified: "status.verified",
  pending: "status.pending",
  unmatched: "status.unmatched",
  rejected: "status.rejected",
} as const satisfies Record<Status, MessageKey>;

const STATUS_ICONS: Record<Status, ReactNode> = {
  verified: <CheckCircleIcon className="h-5 w-5 shrink-0" />,
  pending: <ClockIcon className="h-5 w-5 shrink-0" />,
  unmatched: <AlertTriangleIcon className="h-5 w-5 shrink-0" />,
  rejected: <XCircleIcon className="h-5 w-5 shrink-0" />,
};

export type StatusBadgeProps = {
  status: Status;
  className?: string;
};

/** Status is always a word plus a shape; colour is never the only signal. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useI18n();

  return (
    <span
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-small font-semibold",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_ICONS[status]}
      {t(STATUS_MESSAGE_KEYS[status])}
    </span>
  );
}
