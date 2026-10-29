"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/button";
import { EmptyState } from "../../../../components/empty-state";
import { AlertTriangleIcon, ClockIcon, PlusIcon } from "../../../../components/icons";
import { Money } from "../../../../components/money";
import { StatusBadge } from "../../../../components/status-badge";
import { useDocumentTitle, useI18n } from "../../../../i18n";
import { type FundTreasurerData, fetchFundTreasurerData } from "../../../../lib/expense-service";

export interface TreasurerPageProps {
  params: Promise<{ fundId: string }>;
}

export default function TreasurerPage({ params }: TreasurerPageProps) {
  const { t } = useI18n();
  useDocumentTitle("treasurer.title", "treasurer.fundOverview");

  const [resolvedFundId, setResolvedFundId] = useState<string | null>(null);
  const [data, setData] = useState<FundTreasurerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    Promise.resolve(params).then((p) => setResolvedFundId(p.fundId));
  }, [params]);

  const loadData = useCallback(
    (fId: string) => {
      setLoading(true);
      setError(null);
      fetchFundTreasurerData(fId)
        .then(setData)
        .catch(() => {
          setError(t("treasurer.errorDescription"));
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [t],
  );

  useEffect(() => {
    if (!resolvedFundId) return;
    loadData(resolvedFundId);
  }, [resolvedFundId, loadData]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleRetry = () => {
    if (resolvedFundId) {
      loadData(resolvedFundId);
    }
  };

  const currentFundId = resolvedFundId ?? "demo-fund";

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-24 sm:pb-8">
      {/* Offline Banner */}
      {isOffline ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-control border-2 border-unmatched-border bg-unmatched-bg p-3 text-small font-medium text-unmatched-ink"
        >
          <AlertTriangleIcon className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p>{t("treasurer.offlineNotice")}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="tap-target rounded px-2 text-small font-semibold underline underline-offset-4"
          >
            {t("treasurer.retry")}
          </button>
        </div>
      ) : null}

      {/* Header */}
      <div className="flex flex-col gap-1">
        <span className="text-small font-semibold text-primary">
          {data ? data.fundName : t("treasurer.fundOverview")}
        </span>
        <h1 className="text-display font-bold text-ink">{t("treasurer.title")}</h1>
      </div>

      <p
        role="note"
        className="rounded-control border border-pending-border bg-pending-bg p-3 text-small font-medium text-pending-ink"
      >
        {t("dashboard.demoNotice")}
      </p>

      {/* Loading state */}
      {loading ? (
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 text-center"
        >
          <ClockIcon className="mx-auto h-8 w-8 motion-safe:animate-spin text-primary" />
          <p className="text-body font-medium text-ink-muted">{t("common.loading")}...</p>
        </div>
      ) : error ? (
        /* Error state */
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-card border border-danger bg-surface p-6 text-center"
        >
          <AlertTriangleIcon className="h-10 w-10 text-danger" />
          <h2 className="text-title font-bold text-ink">{t("treasurer.errorTitle")}</h2>
          <p className="max-w-md text-small text-ink-muted">{error}</p>
          <Button type="button" variant="primary" onClick={handleRetry} className="mt-2">
            {t("treasurer.retry")}
          </Button>
        </div>
      ) : data ? (
        <>
          {/* Balance Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-border bg-surface p-5">
              <Money amount={data.totalBalancePaise} label={t("treasurer.totalBalance")} />
            </div>
            <div className="rounded-card border-2 border-primary/20 bg-primary-subtle/20 p-5">
              <Money amount={data.spendableBalancePaise} label={t("treasurer.spendableBalance")} />
            </div>
          </div>

          {/* Pending Expenses Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-title font-semibold text-ink">
                {t("treasurer.pendingExpenses")}
              </h2>
              <span className="rounded-full bg-canvas px-2.5 py-0.5 text-small font-bold text-ink-muted">
                {data.pendingExpenses.length}
              </span>
            </div>

            {data.pendingExpenses.length === 0 ? (
              <EmptyState
                title={t("treasurer.emptyTitle")}
                description={t("treasurer.emptyDescription")}
                action={
                  <Link
                    href={`/funds/${currentFundId}/expenses/new`}
                    className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
                  >
                    {t("treasurer.newExpenseCta")}
                  </Link>
                }
              />
            ) : (
              <ul aria-label={t("treasurer.pendingExpenses")} className="flex flex-col gap-3">
                {data.pendingExpenses.map((expense) => (
                  <li
                    key={expense.id}
                    className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-bold text-ink">{expense.payeeName}</span>
                        <StatusBadge status="pending" />
                      </div>
                      <p className="mt-1 truncate text-small text-ink-muted">{expense.purpose}</p>
                      <time
                        dateTime={expense.createdAt}
                        className="mt-1 block text-small text-ink-muted"
                      >
                        {expense.createdAt}
                      </time>
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-border pt-3 sm:border-t-0 sm:pt-0">
                      <Money amount={expense.amountPaise} />
                      <Link
                        href={`/funds/${currentFundId}/approvals/${expense.id}`}
                        className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-canvas px-4 py-2 text-small font-semibold text-primary hover:bg-primary-subtle"
                      >
                        {t("treasurer.viewExpense")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {/* Prominent Primary CTA: Mobile thumb zone sticky bar / Desktop standard */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 p-3 backdrop-blur-md sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto max-w-2xl">
          <Link
            href={`/funds/${currentFundId}/expenses/new`}
            className="tap-target flex w-full items-center justify-center gap-2 rounded-control border-2 border-primary bg-primary px-6 py-3.5 text-center text-body font-bold text-on-solid shadow-md hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-primary/20"
          >
            <PlusIcon className="h-5 w-5 shrink-0" />
            <span>{t("treasurer.newExpenseCta")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
