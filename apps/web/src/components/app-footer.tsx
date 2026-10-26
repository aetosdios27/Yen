"use client";

import Link from "next/link";
import { useI18n } from "../i18n";

export function AppFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-ink-muted">{t("footer.note")}</p>
        <nav aria-label={t("footer.navLabel")}>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <li>
              <Link
                href="/terms"
                className="tap-target inline-flex items-center rounded-control text-small font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t("footer.terms")}
              </Link>
            </li>
            <li>
              <Link
                href="/privacy"
                className="tap-target inline-flex items-center rounded-control text-small font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t("footer.privacy")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
