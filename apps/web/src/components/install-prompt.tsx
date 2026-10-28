"use client";

import { useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { type UseInstallPromptOptions, useInstallPrompt } from "./use-install-prompt";

export interface InstallPromptProps extends UseInstallPromptOptions {
  className?: string | undefined;
}

export function InstallPrompt({
  trigger,
  minPageViews,
  dismissExpiryMs,
  storageKey,
  sessionKey,
  className = "",
}: InstallPromptProps = {}) {
  const { t } = useI18n();
  const { canPrompt, isIos, promptInstall, dismiss } = useInstallPrompt({
    trigger,
    minPageViews,
    dismissExpiryMs,
    storageKey,
    sessionKey,
  });

  const [showIosInstructions, setShowIosInstructions] = useState(false);

  if (!canPrompt) {
    return null;
  }

  return (
    <section
      aria-label={t("pwa.installTitle")}
      className={`relative mb-6 rounded-card border border-border bg-surface p-4 shadow-card ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 pr-2">
          <h2 className="text-title font-bold text-ink">{t("pwa.installTitle")}</h2>
          <p className="mt-1 text-body text-ink-muted">{t("pwa.installDescription")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 sm:pt-0">
          {isIos ? (
            <Button
              variant="primary"
              onClick={() => setShowIosInstructions((prev) => !prev)}
              aria-expanded={showIosInstructions}
            >
              {t("pwa.iosTrigger")}
            </Button>
          ) : (
            <Button variant="primary" onClick={promptInstall}>
              {t("pwa.installButton")}
            </Button>
          )}

          <Button variant="ghost" onClick={dismiss}>
            {t("pwa.dismissButton")}
          </Button>
        </div>
      </div>

      {isIos && showIosInstructions && (
        <section
          aria-label={t("pwa.iosTrigger")}
          className="mt-4 rounded-control border border-border-strong bg-canvas p-4 text-ink"
        >
          <ol className="space-y-2 text-small">
            <li>{t("pwa.iosStep1")}</li>
            <li>{t("pwa.iosStep2")}</li>
            <li>{t("pwa.iosStep3")}</li>
          </ol>
          <div className="mt-3 text-right">
            <Button variant="secondary" onClick={() => setShowIosInstructions(false)}>
              {t("pwa.iosClose")}
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
