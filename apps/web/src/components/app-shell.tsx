"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { AppFooter } from "./app-footer";
import { InstallPrompt } from "./install-prompt";
import { LocaleSwitcher } from "./locale-switcher";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const showPseudo = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <Link
              href="/"
              className="tap-target inline-flex items-center rounded-control text-title font-bold text-ink"
            >
              {t("app.name")}
            </Link>
            <nav aria-label={t("nav.primary")} className="flex items-center gap-4">
              <Link
                href="/login"
                className="tap-target inline-flex items-center rounded-control text-small font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t("nav.login")}
              </Link>
              <Link
                href="/design-system"
                className="tap-target inline-flex items-center rounded-control text-small font-semibold text-ink-muted underline-offset-4 hover:underline"
              >
                {t("nav.designSystem")}
              </Link>
            </nav>
          </div>
          <LocaleSwitcher showPseudo={showPseudo} className="min-w-0" />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <InstallPrompt />
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
