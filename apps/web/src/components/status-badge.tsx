"use client";

import type { ReactNode } from "react";
import { type MessageKey, useI18n } from "../i18n";
import { cn } from "./cn";
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from "./icons";
import { Badge } from "./ui/badge";

export type Status = "verified" | "pending" | "unmatched" | "rejected" | "refunded";

const STATUS_STYLES: Record<Status, string> = {
  verified: "border-verified-border bg-verified-bg text-verified-ink",
  pending: "border-pending-border bg-pending-bg text-pending-ink",
  unmatched: "border-unmatched-border bg-unmatched-bg text-unmatched-ink",
  refunded: "border-border bg-surface text-ink",
  rejected: "border-rejected-border bg-rejected-bg text-rejected-ink",
};

const STATUS_MESSAGE_KEYS = {
  verified: "status.verified",
  pending: "status.pending",
  unmatched: "status.unmatched",
  rejected: "status.rejected",
  refunded: "status.refunded",
} as const satisfies Record<Status, MessageKey>;

const STATUS_ICONS: Record<Status, ReactNode> = {
  verified: <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />,
  pending: <ClockIcon className="h-3.5 w-3.5 shrink-0" />,
  unmatched: <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />,
  refunded: <XCircleIcon className="h-3.5 w-3.5 shrink-0" />,
  rejected: <XCircleIcon className="h-3.5 w-3.5 shrink-0" />,
};

export type StatusBadgeProps = {
  status: Status;
  className?: string;
};

/** Status is always a word plus a shape; colour is never the only signal. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useI18n();

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-small font-semibold",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_ICONS[status]}
      {t(STATUS_MESSAGE_KEYS[status])}
    </Badge>
  );
}
