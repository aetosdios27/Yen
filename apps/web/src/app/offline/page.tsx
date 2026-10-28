"use client";

import { Button } from "../../components";
import { useDocumentTitle, useI18n } from "../../i18n";

export default function OfflinePage() {
  const { t } = useI18n();
  useDocumentTitle("offline.title");

  const handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="mx-auto flex max-w-[var(--container-phone)] flex-col items-center justify-center px-4 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-ink-muted"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h1 className="text-heading font-semibold text-ink">{t("offline.title")}</h1>
      <p className="mt-4 text-body text-ink-muted">{t("offline.message")}</p>
      <div className="mt-8">
        <Button variant="primary" onClick={handleRetry}>
          {t("offline.retry")}
        </Button>
      </div>
    </div>
  );
}
