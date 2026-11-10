"use client";

import { type AuditBundle, exportAuditBundleCsv, formatInr } from "@yen/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { cn } from "../../components/cn";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
} from "../../components/fund/icons";
import { useI18n } from "../../i18n";
import { generateOfflineVerifierScript, triggerDownload } from "../../lib/offline-script";
import {
  type BundleVerificationReport,
  type RecordProofData,
  type RecordVerificationReport,
  verifyRecordProofData,
  verifyUploadedBundle,
} from "../../lib/verifier";

type VerifyState =
  | { kind: "idle" }
  | { kind: "checking" }
  | {
      kind: "record_result";
      report: RecordVerificationReport;
      proofData?: RecordProofData | undefined;
      bundle?: AuditBundle | undefined;
    }
  | {
      kind: "bundle_result";
      report: BundleVerificationReport;
      bundle: AuditBundle;
    }
  | { kind: "error"; message: string };

function VerifyPageContent() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();

  const initialRecordId = searchParams.get("recordId") || searchParams.get("id") || "";
  const initialFundId = searchParams.get("fundId") || "";

  const [recordIdInput, setRecordIdInput] = useState(initialRecordId);
  const [fundIdInput, setFundIdInput] = useState(initialFundId);
  const [state, setState] = useState<VerifyState>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  const verifyRecordById = useCallback(async (recId: string, fId: string) => {
    if (!recId.trim()) return;
    setState({ kind: "checking" });

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const effectiveFundId = fId.trim() || "00000000-0000-4000-8000-000000000010";
      const endpoint = `${apiUrl}/v1/funds/${encodeURIComponent(effectiveFundId)}/records/${encodeURIComponent(recId.trim())}/proof`;

      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "Record not found in the public account book"
            : `Server returned status ${response.status}`,
        );
      }

      const proofData = (await response.json()) as RecordProofData;
      const report = await verifyRecordProofData(proofData);
      setState({ kind: "record_result", report, proofData });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleBundleUpload = useCallback(async (file: File) => {
    setState({ kind: "checking" });
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as AuditBundle;
      const report = await verifyUploadedBundle(bundle);
      setState({ kind: "bundle_result", report, bundle });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to parse audit bundle JSON",
      });
    }
  }, []);

  // Auto-verify if recordId is provided in URL query
  useEffect(() => {
    if (initialRecordId) {
      verifyRecordById(initialRecordId, initialFundId);
    }
  }, [initialRecordId, initialFundId, verifyRecordById]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyRecordById(recordIdInput, fundIdInput);
  };

  const currentBundle: AuditBundle | undefined =
    state.kind === "bundle_result"
      ? state.bundle
      : state.kind === "record_result"
        ? state.bundle
        : undefined;

  const handleDownloadScript = () => {
    const script = generateOfflineVerifierScript(currentBundle);
    triggerDownload("verify-bundle.mjs", script, "text/javascript");
  };

  const handleDownloadBundleJson = () => {
    if (!currentBundle) return;
    triggerDownload(
      `audit-bundle-${currentBundle.fund_id}.json`,
      JSON.stringify(currentBundle, null, 2),
      "application/json",
    );
  };

  const handleDownloadBundleCsv = () => {
    if (!currentBundle) return;
    const csv = exportAuditBundleCsv(currentBundle);
    triggerDownload(`audit-bundle-${currentBundle.fund_id}.csv`, csv, "text/csv");
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center justify-between">
        {fundIdInput ? (
          <Link
            href={`/funds/${encodeURIComponent(fundIdInput)}`}
            className="inline-flex items-center gap-1.5 text-small font-medium text-primary hover:underline"
          >
            ← {t("verify.backToFund")}
          </Link>
        ) : (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-small font-medium text-primary hover:underline"
          >
            ← {t("verify.backToFund")}
          </Link>
        )}
      </div>

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <ShieldCheckIcon className="h-8 w-8 text-verified-ink shrink-0" />
          <h1 className="text-display font-bold text-ink">{t("verify.title")}</h1>
        </div>
        <p className="mt-2 text-body text-ink-muted">{t("verify.subtitle")}</p>
      </header>

      {/* Manual record verification form */}
      <section
        aria-labelledby="verify-form-heading"
        className="rounded-control border border-border bg-surface p-6 shadow-xs"
      >
        <h2 id="verify-form-heading" className="text-title font-semibold text-ink">
          {t("verify.verifyButton")}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label
              htmlFor="verify-record-id"
              className="block text-small font-medium text-ink mb-1"
            >
              {t("verify.enterRecordIdLabel")}
            </label>
            <input
              id="verify-record-id"
              type="text"
              required
              value={recordIdInput}
              onChange={(e) => setRecordIdInput(e.target.value)}
              placeholder={t("verify.enterRecordIdPlaceholder")}
              className="w-full rounded-control border border-border bg-canvas px-3.5 py-2 text-body text-ink placeholder:text-ink-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="verify-fund-id" className="block text-small font-medium text-ink mb-1">
              {t("verify.fundIdLabel")}
            </label>
            <input
              id="verify-fund-id"
              type="text"
              value={fundIdInput}
              onChange={(e) => setFundIdInput(e.target.value)}
              placeholder={t("verify.fundIdPlaceholder")}
              className="w-full rounded-control border border-border bg-canvas px-3.5 py-2 text-body text-ink placeholder:text-ink-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            type="submit"
            disabled={state.kind === "checking" || !recordIdInput.trim()}
            className="tap-target inline-flex items-center justify-center rounded-control bg-primary px-5 py-2.5 text-body font-semibold text-on-solid hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {state.kind === "checking" ? t("verify.checking") : t("verify.verifyButton")}
          </button>
        </form>

        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-border" />
          </div>
          <span className="relative bg-surface px-3 text-small text-ink-muted uppercase tracking-wider font-semibold">
            {t("verify.uploadBundlePrompt")}
          </span>
        </div>

        {/* File upload drag and drop */}
        <label
          htmlFor="verify-bundle-file"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleBundleUpload(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center rounded-control border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 bg-canvas/50",
          )}
        >
          <DocumentTextIcon className="h-8 w-8 text-ink-muted mb-2 shrink-0" />
          <p className="text-small text-ink font-medium">{t("verify.dropBundleHere")}</p>
          <span className="mt-3 inline-block rounded-control border border-border bg-surface px-3.5 py-1.5 text-small font-medium text-ink hover:bg-canvas">
            {t("verify.uploadBundleButton")}
          </span>
          <input
            id="verify-bundle-file"
            type="file"
            accept=".json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleBundleUpload(file);
            }}
          />
        </label>
      </section>

      {/* Verification status output */}
      <section aria-live="polite" className="mt-8">
        {state.kind === "checking" && (
          <div className="flex items-center justify-center gap-3 rounded-control border border-border bg-surface p-6 text-ink-muted">
            <ClockIcon className="h-5 w-5 animate-spin" />
            <span className="text-body font-medium">{t("verify.checking")}</span>
          </div>
        )}

        {state.kind === "error" && (
          <div className="rounded-control border border-destructive/30 bg-destructive/10 p-5 text-destructive">
            <div className="flex items-start gap-3">
              <AlertTriangleIcon className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-title font-semibold">{t("verify.outcomeFailed")}</h3>
                <p className="mt-1 text-small">{state.message}</p>
              </div>
            </div>
          </div>
        )}

        {state.kind === "record_result" && (
          <article
            className={cn(
              "rounded-control border p-6 transition-all",
              state.report.outcome === "verified"
                ? "border-verified-border bg-verified-bg text-verified-ink"
                : state.report.outcome === "pending"
                  ? "border-pending-border bg-pending-bg text-pending-ink"
                  : state.report.outcome === "skipped"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                    : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <div className="flex items-start gap-3.5">
              {state.report.outcome === "verified" && (
                <CheckCircleIcon className="h-6 w-6 shrink-0 mt-0.5" />
              )}
              {state.report.outcome === "pending" && (
                <ClockIcon className="h-6 w-6 shrink-0 mt-0.5" />
              )}
              {state.report.outcome === "skipped" && (
                <QuestionMarkCircleIcon className="h-6 w-6 shrink-0 mt-0.5" />
              )}
              {state.report.outcome === "failed" && (
                <AlertTriangleIcon className="h-6 w-6 shrink-0 mt-0.5" />
              )}

              <div className="flex-1">
                <span className="text-xs uppercase tracking-wider font-bold opacity-80">
                  {state.report.outcome === "verified"
                    ? t("verify.outcomeVerified")
                    : state.report.outcome === "pending"
                      ? t("verify.outcomePending")
                      : state.report.outcome === "skipped"
                        ? t("verify.outcomeSkipped")
                        : t("verify.outcomeFailed")}
                </span>

                <h2 className="mt-1 text-title font-bold leading-snug">{state.report.headline}</h2>
                <p className="mt-2 text-small leading-relaxed opacity-90">
                  {state.report.detailMessage}
                </p>

                {/* Summary information grid */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs border-t border-current/15 pt-3">
                  <div>
                    <span className="opacity-75 block">{t("verify.enterRecordIdLabel")}</span>
                    <span className="font-mono font-medium truncate block">
                      {state.report.recordId}
                    </span>
                  </div>
                  {state.report.amountPaise !== undefined && (
                    <div>
                      <span className="opacity-75 block">Amount</span>
                      <span className="font-bold text-sm block">
                        {formatInr(state.report.amountPaise)}
                      </span>
                    </div>
                  )}
                  {state.report.occurredAt && (
                    <div>
                      <span className="opacity-75 block">Date recorded</span>
                      <span className="font-medium block">
                        {new Date(state.report.occurredAt).toLocaleString(locale)}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="opacity-75 block">Seal verification</span>
                    <span className="font-medium block">
                      {state.report.checks.onChainAnchorValid === true
                        ? "Public registry seal verified"
                        : state.report.checks.onChainAnchorValid === "pending"
                          ? "Pending public seal batch"
                          : "Cryptographic proof intact (offline check)"}
                    </span>
                  </div>
                </div>

                {/* Expandable technical details for skeptics & auditors */}
                <details className="mt-5 rounded-control border border-border bg-surface p-4 text-ink">
                  <summary className="cursor-pointer text-small font-semibold text-primary hover:underline">
                    {t("verify.technicalInspectionTitle")}
                  </summary>

                  <div className="mt-3 space-y-3 text-xs">
                    <p className="text-ink-muted">{t("verify.technicalInspectionDesc")}</p>

                    <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 font-mono">
                      <div>
                        <span className="text-ink-muted block text-[11px]">
                          {t("verify.canonicalHashLabel")}
                        </span>
                        <span className="break-all text-ink select-all">
                          {state.report.technical.canonicalEventHash}
                        </span>
                      </div>

                      <div>
                        <span className="text-ink-muted block text-[11px]">
                          {t("verify.declaredHashLabel")}
                        </span>
                        <span className="break-all text-ink select-all">
                          {state.report.technical.declaredHash}
                        </span>
                      </div>

                      {state.report.technical.salt && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.saltLabel")}
                          </span>
                          <span className="break-all text-ink select-all">
                            {state.report.technical.salt}
                          </span>
                        </div>
                      )}

                      {state.report.technical.expectedRoot && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.globalRootLabel")}
                          </span>
                          <span className="break-all text-ink select-all">
                            {state.report.technical.expectedRoot}
                          </span>
                        </div>
                      )}

                      {state.report.technical.onChainRoot && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.onChainRootLabel")}
                          </span>
                          <span className="break-all text-ink select-all">
                            {state.report.technical.onChainRoot}
                          </span>
                        </div>
                      )}

                      {state.report.technical.contractAddress && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.registryAddressLabel")}
                          </span>
                          <span className="break-all text-ink select-all">
                            {state.report.technical.contractAddress}
                          </span>
                        </div>
                      )}

                      {state.report.technical.batchSequence !== undefined && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.batchSequenceLabel")}
                          </span>
                          <span className="text-ink">{state.report.technical.batchSequence}</span>
                        </div>
                      )}

                      {state.report.technical.txHash && (
                        <div>
                          <span className="text-ink-muted block text-[11px]">
                            {t("verify.txHashLabel")}
                          </span>
                          <span className="break-all text-ink select-all">
                            {state.report.technical.txHash}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border pt-2">
                      <span className="text-ink-muted block text-[11px] mb-1 font-mono">
                        Raw Event Record
                      </span>
                      <pre className="max-h-48 overflow-auto rounded bg-canvas p-2 text-[11px] text-ink font-mono">
                        {JSON.stringify(state.report.rawEvent, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </article>
        )}

        {state.kind === "bundle_result" && (
          <article
            className={cn(
              "rounded-control border p-6",
              state.report.allValid
                ? "border-verified-border bg-verified-bg text-verified-ink"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <div className="flex items-start gap-3.5">
              {state.report.allValid ? (
                <CheckCircleIcon className="h-6 w-6 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangleIcon className="h-6 w-6 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h2 className="text-title font-bold">
                  {state.report.allValid
                    ? `Audit Bundle Verified: ${state.report.totalEvents} record(s) intact`
                    : "Audit Bundle Verification Failed"}
                </h2>
                <p className="mt-1 text-small opacity-90">{t("verify.offlineNotice")}</p>

                <div className="mt-4 space-y-2 border-t border-current/15 pt-3 text-xs">
                  {state.report.checks.map((check) => (
                    <div
                      key={check.name}
                      className="flex items-center justify-between py-1 border-b border-current/10"
                    >
                      <span className="font-medium">{check.name}</span>
                      <span className="font-semibold uppercase tracking-wider">
                        {check.ok ? "✓ Pass" : "✗ Fail"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        )}
      </section>

      {/* Export & Standalone Script Action Bar */}
      <section aria-labelledby="downloads-heading" className="mt-8 border-t border-border pt-6">
        <h2 id="downloads-heading" className="text-title font-semibold text-ink mb-3">
          Audit Exports & Independent Verification
        </h2>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleDownloadScript}
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-3 py-2 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <DocumentTextIcon className="h-4 w-4 text-primary shrink-0" />
            <span>{t("verify.downloadVerifierScript")}</span>
            <ArrowUpRightIcon className="h-3 w-3 text-ink-muted shrink-0" />
          </button>

          {currentBundle && (
            <>
              <button
                type="button"
                onClick={handleDownloadBundleJson}
                className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-3 py-2 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span>{t("verify.downloadBundleJson")}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBundleCsv}
                className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-3 py-2 text-small font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span>{t("verify.downloadBundleCsv")}</span>
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <ClockIcon className="h-8 w-8 animate-spin text-ink-muted" />
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
