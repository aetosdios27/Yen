"use client";

import Link from "next/link";
import { useI18n } from "../../../i18n";

export default function ReceiptNotFound() {
  const { t } = useI18n();

  return (
    <article className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-heading font-bold text-ink">{t("receipt.notFoundTitle")}</h1>
      <p className="text-body text-ink-muted">{t("receipt.notFoundBody")}</p>
      <Link
        href="/"
        className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
      >
        {t("receipt.backToFund")}
      </Link>
    </article>
  );
}
