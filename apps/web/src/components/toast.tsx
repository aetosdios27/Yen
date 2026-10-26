"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useI18n } from "../i18n";
import { cn } from "./cn";
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCircleIcon, XIcon } from "./icons";

export type ToastTone = "success" | "info" | "warning" | "error";

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-verified-border bg-verified-bg text-verified-ink",
  info: "border-border-strong bg-surface text-ink",
  warning: "border-unmatched-border bg-unmatched-bg text-unmatched-ink",
  error: "border-rejected-border bg-rejected-bg text-rejected-ink",
};

const TONE_ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />,
  info: <InfoIcon className="mt-0.5 h-5 w-5 shrink-0" />,
  warning: <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />,
  error: <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />,
};

export type ToastProps = {
  title: string;
  description?: string;
  tone?: ToastTone;
  onClose?: () => void;
};

export function Toast({ title, description, tone = "info", onClose }: ToastProps) {
  const { t } = useI18n();

  function handleEscape(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && onClose !== undefined) {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className={cn("flex items-start gap-2 rounded-card border-2 p-3", TONE_STYLES[tone])}>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex min-w-0 flex-1 items-start gap-2"
      >
        {TONE_ICONS[tone]}
        <div className="min-w-0 break-words">
          <p className="text-body font-semibold">{title}</p>
          {description === undefined ? null : <p className="mt-0.5 text-small">{description}</p>}
        </div>
      </div>
      {onClose === undefined ? null : (
        <button
          type="button"
          onClick={onClose}
          onKeyDown={handleEscape}
          aria-label={t("common.dismiss")}
          className="tap-target inline-flex shrink-0 items-center justify-center rounded-control border border-current"
        >
          <XIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
