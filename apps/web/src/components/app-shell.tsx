"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { SessionNav } from "./session-nav";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="border-b border-border bg-surface">
        <nav
          aria-label={t("nav.primary")}
          className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:gap-8"
        >
          <Link
            href="/"
            className="tap-target inline-flex shrink-0 items-center rounded-control text-title font-bold tracking-tight text-primary"
          >
            {t("app.name")}
          </Link>
          <SessionNav />
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-app px-4 py-6 text-caption text-ink-muted">
        <a href="https://rareui.com" className="underline underline-offset-4">
          {t("precision.credit", { name: "Rare UI" })}
        </a>
      </footer>
    </div>
  );
}
