"use client";

import { formatInr } from "@yen/shared";
import { useMemo, useState } from "react";
import { type MessageKey, useI18n } from "../../i18n";
import { cn } from "../cn";
import type { PublicTimelineEntry, SpendingCategoryId } from "./types";
import { VerifiedBadge } from "./verified-badge";

export type FundTimelineProps = {
  readonly timeline: readonly PublicTimelineEntry[];
  readonly fundId?: string | undefined;
  readonly onOpenExplainer: () => void;
  readonly className?: string | undefined;
};

type FilterType = "all" | "donations" | "expenses";

const CATEGORY_MESSAGE_KEYS: Record<SpendingCategoryId, MessageKey> = {
  equipment: "fund.categoryEquipment",
  travel: "fund.categoryTravel",
  registration: "fund.categoryRegistration",
  logistics: "fund.categoryLogistics",
  food: "fund.categoryFood",
  other: "fund.categoryOther",
};

export function FundTimeline({ timeline, fundId, onOpenExplainer, className }: FundTimelineProps) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<FilterType>("all");

  const counts = useMemo(() => {
    let donations = 0;
    let expenses = 0;
    for (const item of timeline) {
      if (item.type === "donation") {
        donations += 1;
      } else {
        expenses += 1;
      }
    }
    return { all: timeline.length, donations, expenses };
  }, [timeline]);

  const filteredItems = useMemo(() => {
    if (filter === "donations") {
      return timeline.filter((item) => item.type === "donation");
    }
    if (filter === "expenses") {
      return timeline.filter((item) => item.type === "expense");
    }
    return timeline;
  }, [timeline, filter]);

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <section
      aria-labelledby="timeline-heading"
      className={cn("rounded-control border border-border bg-surface p-5", className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="timeline-heading" className="text-title font-bold text-ink">
            {t("fund.timelineTitle")}
          </h2>
          <p className="mt-1 text-small text-ink-muted">{t("fund.timelineDescription")}</p>
        </div>

        {/* Filter buttons */}
        <div
          role="tablist"
          aria-label={t("fund.timelineTitle")}
          className="flex flex-wrap gap-1 rounded-control bg-canvas p-1 border border-border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
            className={cn(
              "tap-target inline-flex items-center rounded-control px-3 py-1.5 text-small font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              filter === "all" ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink",
            )}
          >
            {t("fund.filterAll", { count: counts.all })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "donations"}
            onClick={() => setFilter("donations")}
            className={cn(
              "tap-target inline-flex items-center rounded-control px-3 py-1.5 text-small font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              filter === "donations"
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {t("fund.filterDonations", { count: counts.donations })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "expenses"}
            onClick={() => setFilter("expenses")}
            className={cn(
              "tap-target inline-flex items-center rounded-control px-3 py-1.5 text-small font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              filter === "expenses"
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {t("fund.filterExpenses", { count: counts.expenses })}
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <p className="mt-6 text-center text-body text-ink-muted">{t("fund.emptyFilter")}</p>
      ) : (
        <ol aria-label={t("fund.timelineTitle")} className="mt-6 flex flex-col gap-4">
          {filteredItems.map((entry) => {
            const isDonation = entry.type === "donation";
            const categoryLabel =
              entry.category && CATEGORY_MESSAGE_KEYS[entry.category]
                ? t(CATEGORY_MESSAGE_KEYS[entry.category])
                : undefined;

            return (
              <li
                key={entry.id}
                className="flex flex-col gap-3 rounded-control border border-border bg-canvas p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded px-2 py-0.5 text-small font-semibold",
                        isDonation
                          ? "bg-verified-bg text-verified-ink"
                          : "bg-surface text-ink border border-border",
                      )}
                    >
                      {isDonation ? t("fund.donationItem") : t("fund.expenseItem")}
                    </span>

                    {categoryLabel ? (
                      <span className="text-small text-ink-muted">· {categoryLabel}</span>
                    ) : null}

                    <time dateTime={entry.dateTime} className="text-small text-ink-muted">
                      · {formatDate(entry.dateTime)}
                    </time>
                  </div>

                  <h3 className="mt-1.5 text-body font-bold text-ink">{entry.title}</h3>

                  {entry.description ? (
                    <p className="mt-1 text-small leading-relaxed text-ink-muted">
                      {entry.description}
                    </p>
                  ) : null}

                  {entry.donorName ? (
                    <p className="mt-1 text-small text-ink-muted">
                      {isDonation
                        ? `${t("fund.communityDonor")}: ${entry.donorName}`
                        : entry.donorName}
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <VerifiedBadge
                      status={entry.status}
                      evidence={entry.evidence}
                      verification={entry.verification}
                      recordId={entry.id}
                      fundId={fundId}
                      onOpenExplainer={onOpenExplainer}
                    />
                  </div>
                </div>

                <div className="shrink-0 text-left sm:text-right">
                  <span
                    className={cn(
                      "block text-title font-bold tabular-nums",
                      isDonation ? "text-verified-ink" : "text-ink",
                    )}
                  >
                    {isDonation ? `+ ${formatInr(entry.amount)}` : `- ${formatInr(entry.amount)}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
