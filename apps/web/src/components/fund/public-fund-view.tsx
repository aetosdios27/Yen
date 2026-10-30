"use client";

import { useState } from "react";
import { useI18n } from "../../i18n";
import { cn } from "../cn";
import { FundHeader } from "./fund-header";
import { FundTimeline } from "./fund-timeline";
import { HowDoIKnowModal } from "./how-do-i-know-modal";
import { MoneySummary } from "./money-summary";
import { SpendingBreakdown } from "./spending-breakdown";
import type { PublicFund } from "./types";

export type PublicFundViewProps = {
  readonly fund: PublicFund;
  readonly className?: string | undefined;
};

export function PublicFundView({ fund, className }: PublicFundViewProps) {
  const [isExplainerOpen, setExplainerOpen] = useState(false);
  const { t, locale } = useI18n();

  return (
    <article className={cn("flex flex-col gap-8 pb-12", className)}>
      <FundHeader fundId={fund.id} name={fund.name} purpose={fund.purpose} org={fund.org} />

      {fund.dataAsOf === undefined ? null : (
        <p
          role="status"
          className="rounded-card border-2 border-pending-border bg-pending-bg p-4 text-small text-pending-ink"
        >
          {t("fund.savedCopy", { time: new Date(fund.dataAsOf).toLocaleString(locale) })}
        </p>
      )}

      <MoneySummary money={fund.money} />

      <SpendingBreakdown categories={fund.spendingBreakdown} />

      <FundTimeline timeline={fund.timeline} onOpenExplainer={() => setExplainerOpen(true)} />

      <HowDoIKnowModal isOpen={isExplainerOpen} onClose={() => setExplainerOpen(false)} />
    </article>
  );
}
