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

export interface NewExpensePageProps {
  params: Promise<{ fundId: string }>;
}

export default function NewExpensePage({ params }: NewExpensePageProps) {
  const { fundId } = use(params);
  const router = useRouter();
  const { t } = useI18n();
  useDocumentTitle("expenseForm.title", "expenseForm.subtitle");

  const [fundData, setFundData] = useState<FundTreasurerData | null>(null);

  useEffect(() => {
    fetchFundTreasurerData(fundId)
      .then(setFundData)
      .catch(() => {});
  }, [fundId]);

  const handleSubmit = async (submission: ValidatedExpenseSubmission) => {
    await createExpenseRequest(fundId, submission);
    router.push(`/funds/${fundId}/treasurer`);
  };

  const handleCancel = () => {
    router.push(`/funds/${fundId}/treasurer`);
  };

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

      <ExpenseForm
        fundId={fundId}
        spendableBalancePaise={fundData?.spendableBalancePaise}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </section>
  );
}
