"use client";

import Link from "next/link";
import { useI18n } from "../../i18n";
import { cn } from "../cn";
import { QrCodeIcon, ShieldCheckIcon } from "./icons";
import type { PublicOrg } from "./types";

export type FundHeaderProps = {
  readonly fundId: string;
  readonly name: string;
  readonly purpose: string;
  readonly org: PublicOrg;
  readonly className?: string | undefined;
};

export function FundHeader({ fundId, name, purpose, org, className }: FundHeaderProps) {
  const { t } = useI18n();

  return (
    <header className={cn("flex flex-col gap-4 border-b border-border pb-6", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-verified-border bg-verified-bg px-3 py-1 text-small font-semibold text-verified-ink">
          <ShieldCheckIcon className="h-4 w-4 shrink-0" />
          <span>{org.name}</span>
          {org.verified ? (
            <>
              <span className="text-small text-verified-ink" aria-hidden="true">
                ✓
              </span>
              <span className="sr-only">({t("fund.verifiedOrg")})</span>
            </>
          ) : null}
        </span>
        {org.legalForm ? (
          <span className="text-small text-ink-muted">· {org.legalForm}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex-1">
          <h1 className="text-display font-bold tracking-tight text-ink">{name}</h1>
          <p className="mt-2 text-body leading-relaxed text-ink-muted">{purpose}</p>
        </div>

        <div className="mt-2 shrink-0 md:mt-0">
          <Link
            href={`/funds/${fundId}/donate`}
            className="tap-target inline-flex items-center justify-center gap-2 rounded-control bg-primary px-5 py-3 text-body font-semibold text-on-solid transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <QrCodeIcon className="h-5 w-5 shrink-0" />
            <span>{t("fund.donateCta")}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
