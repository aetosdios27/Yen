"use client";

import { useEffect } from "react";
import { Button } from "../components/button";
import { useI18n } from "../i18n";
import { reportClientError } from "../lib/observability";

type ErrorScreenProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorScreen({ error, reset }: ErrorScreenProps) {
  const { t } = useI18n();
  useEffect(() => {
    reportClientError(error, {
      extra: error.digest === undefined ? undefined : { digest: error.digest },
    });
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[var(--container-phone)] flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("errors.title")}</h1>
      <p className="mt-2 text-ink-muted">{t("errors.body")}</p>
      <Button className="mt-6" onClick={reset}>
        {t("errors.retry")}
      </Button>
    </div>
  );
}
