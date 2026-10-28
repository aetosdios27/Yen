"use client";

import Link from "next/link";
import { useDocumentTitle, useI18n } from "../i18n";

export default function Home() {
  const { t } = useI18n();
  useDocumentTitle("metadata.appTitle", "metadata.appDescription");

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 py-6">
      <h1 className="text-display font-bold tracking-tight text-ink">{t("home.title")}</h1>
      <p className="max-w-prose text-lead text-ink-muted">{t("home.intro")}</p>
      <Link
        href="/design-system"
        className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-canvas px-5 py-3 text-body font-semibold text-primary hover:bg-primary-subtle"
      >
        {t("home.designSystemCta")}
      </Link>
    </section>
  );
}
