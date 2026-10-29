"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { XIcon } from "../icons";
import { DocumentTextIcon, QrCodeIcon, ShieldCheckIcon } from "./icons";

export type HowDoIKnowModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
};

export function HowDoIKnowModal({ isOpen, onClose }: HowDoIKnowModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActive = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousActive?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-do-i-know-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-control border border-border bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-6 w-6 text-verified-ink" />
            <h2 id="how-do-i-know-title" className="text-title font-bold text-ink">
              {t("fund.howDoIKnowTitle")}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="tap-target inline-flex items-center justify-center rounded-control p-2 text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-label={t("fund.closeExplainer")}
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-body leading-relaxed text-ink-muted">{t("fund.howDoIKnowIntro")}</p>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex gap-3 rounded-control border border-border bg-canvas p-4">
            <QrCodeIcon className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-body font-semibold text-ink">
                {t("fund.bankVerificationTitle")}
              </h3>
              <p className="mt-1 text-small leading-relaxed text-ink-muted">
                {t("fund.bankVerificationDesc")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-control border border-border bg-canvas p-4">
            <ShieldCheckIcon className="mt-1 h-5 w-5 shrink-0 text-verified-ink" />
            <div>
              <h3 className="text-body font-semibold text-ink">{t("fund.approvalsTitle")}</h3>
              <p className="mt-1 text-small leading-relaxed text-ink-muted">
                {t("fund.approvalsDesc")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-control border border-border bg-canvas p-4">
            <DocumentTextIcon className="mt-1 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-body font-semibold text-ink">{t("fund.evidenceTitle")}</h3>
              <p className="mt-1 text-small leading-relaxed text-ink-muted">
                {t("fund.evidenceDesc")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-control border border-border bg-canvas p-4">
            <ShieldCheckIcon className="mt-1 h-5 w-5 shrink-0 text-verified-ink" />
            <div>
              <h3 className="text-body font-semibold text-ink">{t("fund.tamperProofTitle")}</h3>
              <p className="mt-1 text-small leading-relaxed text-ink-muted">
                {t("fund.tamperProofDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="tap-target inline-flex items-center justify-center rounded-control border border-border-strong bg-canvas px-4 py-2 text-body font-medium text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("fund.closeExplainer")}
          </button>
        </div>
      </div>
    </div>
  );
}
