"use client";

import { type MessageKey, useI18n } from "../../i18n";
import { cn } from "../cn";
import { Money } from "../money";
import type { SpendingCategory, SpendingCategoryId } from "./types";

export type SpendingBreakdownProps = {
  readonly categories: readonly SpendingCategory[];
  readonly className?: string | undefined;
};

const CATEGORY_MESSAGE_KEYS: Record<SpendingCategoryId, MessageKey> = {
  equipment: "fund.categoryEquipment",
  travel: "fund.categoryTravel",
  registration: "fund.categoryRegistration",
  logistics: "fund.categoryLogistics",
  food: "fund.categoryFood",
  other: "fund.categoryOther",
};

export function SpendingBreakdown({ categories, className }: SpendingBreakdownProps) {
  const { t } = useI18n();

  return (
    <section
      aria-labelledby="spending-breakdown-heading"
      className={cn("rounded-control border border-border bg-surface p-5", className)}
    >
      <h2 id="spending-breakdown-heading" className="text-title font-bold text-ink">
        {t("fund.spendingTitle")}
      </h2>

      {categories.length === 0 ? (
        <p className="mt-4 text-body text-ink-muted">{t("fund.spendingEmpty")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {categories.map((cat) => {
            const labelKey = CATEGORY_MESSAGE_KEYS[cat.id] ?? "fund.categoryOther";
            const label = t(labelKey);
            const shareText = t("fund.spendingShare", { percent: cat.percentage });

            return (
              <div key={cat.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body font-semibold text-ink">{label}</span>
                  <div className="flex items-baseline gap-2">
                    <Money amount={cat.amount} className="text-body font-bold text-ink" />
                    <span className="text-small text-ink-muted">({shareText})</span>
                  </div>
                </div>

                <div
                  role="progressbar"
                  aria-valuenow={cat.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label}: ${cat.percentage}%`}
                  className="h-3 w-full overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.max(2, Math.min(100, cat.percentage))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
