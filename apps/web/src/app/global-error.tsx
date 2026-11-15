"use client";

import { useEffect } from "react";
import { reportClientError } from "../lib/observability";

type GlobalErrorScreenProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Renders outside the root layout, so the locale provider is unavailable and
// the copy stays in English.
export default function GlobalErrorScreen({ error, reset }: GlobalErrorScreenProps) {
  useEffect(() => {
    reportClientError(error, {
      extra: error.digest === undefined ? undefined : { digest: error.digest },
    });
  }, [error]);
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-dvh max-w-[var(--container-phone)] flex-col items-center justify-center px-4 py-16 text-center">
          <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-ink-muted">
            An unexpected error occurred. The failure was reported to the maintainers.
          </p>
          <button
            className="mt-6 rounded-full border border-border px-4 py-2 text-ink"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
