"use client";

import { useI18n } from "../../i18n";
import { cn } from "../cn";
import { Money } from "../money";
import type { PublicFundMoney } from "./types";

export type MoneySummaryProps = {
  readonly money: PublicFundMoney;
  readonly className?: string | undefined;
};

export function MoneySummary({ money, className }: MoneySummaryProps) {
  const { t } = useI18n();

  return (
    <section
      aria-label={t("fund.summaryTitle")}
      className={cn(
        "grid grid-cols-1 divide-y divide-border overflow-hidden rounded-control border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
    >
      <div className="flex flex-col justify-between p-5">
        <span className="text-small font-medium text-ink-muted">{t("fund.totalRaised")}</span>
        <div className="mt-2">
          <Money amount={money.totalRaised} className="text-[1.75rem] font-semibold text-ink" />
        </div>
      </div>

      <div className="flex flex-col justify-between p-5">
        <span className="text-small font-medium text-ink-muted">{t("fund.totalSpent")}</span>
        <div className="mt-2">
          <Money amount={money.totalSpent} className="text-[1.75rem] font-semibold text-ink" />
        </div>
      </div>

      <div className="flex flex-col justify-between p-5">
        <span className="text-small font-medium text-verified-ink">{t("fund.currentBalance")}</span>
        <div className="mt-2">
          <Money
            amount={money.currentBalance}
            className="text-[1.75rem] font-semibold text-verified-ink"
          />
        </div>
      </div>
    </section>
  );
}
