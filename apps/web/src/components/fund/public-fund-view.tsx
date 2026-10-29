"use client";

import { useState } from "react";
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

  return (
    <article className={cn("flex flex-col gap-8 pb-12", className)}>
      <FundHeader fundId={fund.id} name={fund.name} purpose={fund.purpose} org={fund.org} />

      <MoneySummary money={fund.money} />

      <SpendingBreakdown categories={fund.spendingBreakdown} />

      <FundTimeline
        timeline={fund.timeline}
        fundId={fund.id}
        onOpenExplainer={() => setExplainerOpen(true)}
      />

      <HowDoIKnowModal isOpen={isExplainerOpen} onClose={() => setExplainerOpen(false)} />
    </article>
  );
}
