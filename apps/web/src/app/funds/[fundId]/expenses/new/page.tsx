"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import {
  ExpenseForm,
  type ValidatedExpenseSubmission,
} from "../../../../../components/expense-form";
import { useDocumentTitle, useI18n } from "../../../../../i18n";
import {
  createExpenseRequest,
  type FundTreasurerData,
  fetchFundTreasurerData,
} from "../../../../../lib/expense-service";

import { useProductSession } from "../../../../../lib/product-session";

export interface NewExpensePageProps {
  params: Promise<{ fundId: string }>;
}

export default function NewExpensePage({ params }: NewExpensePageProps) {
  const { fundId } = use(params);
  const router = useRouter();
  const { t } = useI18n();
  const { session } = useProductSession();
  const canCreate =
    session.kind === "ready" &&
    session.funds.some(
      (fund) => fund.id === fundId && (fund.role === "owner" || fund.role === "treasurer"),
    );
  useDocumentTitle("expenseForm.title", "expenseForm.subtitle");

  const [fundData, setFundData] = useState<FundTreasurerData | null>(null);

  useEffect(() => {
    if (!canCreate) return;
    fetchFundTreasurerData(fundId)
      .then(setFundData)
      .catch(() => {});
  }, [fundId, canCreate]);

  const handleSubmit = async (submission: ValidatedExpenseSubmission) => {
    if (!canCreate) return;
    await createExpenseRequest(fundId, submission);
    router.push(`/funds/${fundId}/treasurer`);
  };

  const handleCancel = () => {
    router.push(`/funds/${fundId}/treasurer`);
  };

  if (session.kind === "loading") return <p role="status">{t("common.loading")}</p>;
  if (!canCreate)
    return (
      <div role="alert">
        <p>{t(session.kind === "error" ? "product.error" : "expenseForm.noPermission")}</p>
        <Link href={`/funds/${fundId}/dashboard`}>{t("product.allFunds")}</Link>
      </div>
    );

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
      <nav aria-label="Breadcrumb" className="text-small text-ink-muted">
        <Link
          href={`/funds/${fundId}/treasurer`}
          className="tap-target font-semibold text-primary underline-offset-4 hover:underline"
        >
          ← {t("treasurer.title")}
        </Link>
      </nav>

      {fundData ? (
        <p className="text-small font-medium text-ink-muted">{fundData.fundName}</p>
      ) : null}

      <ExpenseForm
        fundId={fundId}
        spendableBalancePaise={fundData?.spendableBalancePaise}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </section>
  );
}
