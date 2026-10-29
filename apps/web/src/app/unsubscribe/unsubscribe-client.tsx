"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "../../components/button";
import { useI18n } from "../../i18n";

export interface UnsubscribeClientProps {
  initialToken?: string | undefined;
  apiUrl: string;
}

export function UnsubscribeClient({ initialToken, apiUrl }: UnsubscribeClientProps) {
  const { t } = useI18n();
  const [token] = useState(initialToken?.trim() ?? "");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    initialToken?.trim() ? "idle" : "error",
  );

  const apiBase = apiUrl.replace(/\/+$/, "");

  async function handleUnsubscribe() {
    if (!token || status === "submitting") return;
    setStatus("submitting");

    try {
      const response = await fetch(`${apiBase}/v1/subscriptions/unsubscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (!token) {
    return (
      <article className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-12 text-center">
        <h1 className="text-heading font-bold text-ink">{t("unsubscribe.title")}</h1>
        <p role="alert" className="text-body text-danger">
          {t("unsubscribe.missingToken")}
        </p>
        <Link
          href="/"
          className="tap-target inline-flex items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
        >
          {t("unsubscribe.returnHome")}
        </Link>
      </article>
    );
  }

  if (status === "success") {
    return (
      <article className="mx-auto flex w-full max-w-xl flex-col gap-6 py-12">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-card border-2 border-verified-border bg-verified-bg p-6 text-verified-ink"
        >
          <h1 className="text-title font-bold">{t("unsubscribe.successTitle")}</h1>
          <p className="text-body">{t("unsubscribe.successBody")}</p>
        </div>
        <Link
          href="/"
          className="tap-target inline-flex self-start items-center justify-center rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid hover:bg-primary-hover"
        >
          {t("unsubscribe.returnHome")}
        </Link>
      </article>
    );
  }

  return (
    <article className="mx-auto flex w-full max-w-xl flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-bold tracking-tight text-ink">{t("unsubscribe.title")}</h1>
        <p className="text-body text-ink-muted">{t("unsubscribe.intro")}</p>
      </header>

      {status === "error" && (
        <p role="alert" className="text-small font-semibold text-danger">
          {t("unsubscribe.error")}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <Button
          variant="danger"
          onClick={handleUnsubscribe}
          loading={status === "submitting"}
          loadingLabel={t("unsubscribe.unsubscribing")}
        >
          {t("unsubscribe.confirmButton")}
        </Button>
        <Link
          href="/"
          className="tap-target inline-flex items-center justify-center text-small font-semibold text-ink-muted underline-offset-4 hover:underline"
        >
          {t("unsubscribe.returnHome")}
        </Link>
      </div>
    </article>
  );
}
