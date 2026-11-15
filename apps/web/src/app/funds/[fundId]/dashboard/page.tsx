"use client";

import Link from "next/link";
import { use } from "react";
import { Button } from "../../../../components/button";
import { useI18n } from "../../../../i18n";
import { useProductSession } from "../../../../lib/product-session";
import TreasurerPage, { type TreasurerPageProps } from "../treasurer/page";

export type { TreasurerPageProps };

export default function DashboardPage({ params }: TreasurerPageProps) {
  const { fundId } = use(params);
  const { session, retry } = useProductSession();
  const { t } = useI18n();

  if (session.kind === "loading") return <p role="status">{t("common.loading")}</p>;
  if (session.kind === "error")
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>{t("product.error")}</p>
        <Button onClick={retry}>{t("errors.retry")}</Button>
      </div>
    );
  if (session.kind === "signedOut") return <Link href="/login">{t("nav.login")}</Link>;

  const fund = session.funds.find((item) => item.id === fundId);
  if (!fund || fund.role === "member")
    return <Link href={`/funds/${encodeURIComponent(fundId)}`}>{t("fund.title")}</Link>;
  return (
    <TreasurerPage params={params} view={fund.role === "approver" ? "approver" : "treasurer"} />
  );
}
