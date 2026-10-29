"use client";

import { useI18n } from "../../i18n";
import { cn } from "../cn";
import { CheckCircleIcon, ClockIcon } from "../icons";
import {
  ArrowUpRightIcon,
  DocumentTextIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
} from "./icons";
import type { PublicEvidence, PublicVerification } from "./types";

export type VerifiedBadgeProps = {
  readonly status: "verified" | "skipped" | "pending" | "unverified";
  readonly evidence?: PublicEvidence | undefined;
  readonly verification?: PublicVerification | undefined;
  readonly recordId?: string | undefined;
  readonly fundId?: string | undefined;
  readonly onOpenExplainer: () => void;
  readonly className?: string | undefined;
};

export function VerifiedBadge({
  status,
  evidence,
  verification,
  recordId,
  fundId,
  onOpenExplainer,
  className,
}: VerifiedBadgeProps) {
  const { t } = useI18n();

  const badgeConfig = {
    verified: {
      className: "border-verified-border bg-verified-bg text-verified-ink",
      icon: <CheckCircleIcon className="h-4 w-4 shrink-0" />,
      text: t("fund.verifiedBadge"),
    },
    skipped: {
      className: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      icon: <QuestionMarkCircleIcon className="h-4 w-4 shrink-0" />,
      text: t("verify.outcomeSkipped"),
    },
    unverified: {
      className: "border-border bg-canvas text-ink-muted",
      icon: <ClockIcon className="h-4 w-4 shrink-0" />,
      text: "Unverified",
    },
    pending: {
      className: "border-pending-border bg-pending-bg text-pending-ink",
      icon: <ClockIcon className="h-4 w-4 shrink-0" />,
      text: t("fund.pendingBadge"),
    },
  }[status] ?? {
    className: "border-pending-border bg-pending-bg text-pending-ink",
    icon: <ClockIcon className="h-4 w-4 shrink-0" />,
    text: t("fund.pendingBadge"),
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-small font-semibold",
          badgeConfig.className,
        )}
      >
        {badgeConfig.icon}
        <span>{badgeConfig.text}</span>
      </span>

      {evidence ? (
        <a
          href={evidence.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-1 rounded-control border border-border bg-surface px-2.5 py-0.5 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={`${t("fund.viewEvidence")}: ${evidence.title}`}
        >
          <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{t("fund.viewEvidence")}</span>
          <ArrowUpRightIcon className="h-3 w-3 shrink-0 text-ink-muted" />
        </a>
      ) : null}

      {recordId ? (
        <a
          href={`/verify?recordId=${encodeURIComponent(recordId)}${fundId ? `&fundId=${encodeURIComponent(fundId)}` : ""}`}
          className="inline-flex min-h-8 items-center gap-1 rounded-control border border-border bg-surface px-2.5 py-0.5 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={t("fund.checkRecordAria")}
        >
          <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-verified-ink" />
          <span>{t("fund.checkRecord")}</span>
          <ArrowUpRightIcon className="h-3 w-3 shrink-0 text-ink-muted" />
        </a>
      ) : verification?.recordProofUrl ? (
        <a
          href={verification.recordProofUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-1 rounded-control border border-border bg-surface px-2.5 py-0.5 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-verified-ink" />
          <span>{t("fund.viewProof")}</span>
          <ArrowUpRightIcon className="h-3 w-3 shrink-0 text-ink-muted" />
        </a>
      ) : null}

      <button
        type="button"
        onClick={onOpenExplainer}
        className="tap-target inline-flex items-center gap-1 text-small font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <QuestionMarkCircleIcon className="h-4 w-4 shrink-0" />
        <span>{t("fund.howDoIKnow")}</span>
      </button>
    </div>
  );
}
