type ClientErrorContext = {
  readonly route?: string;
  readonly requestId?: string;
};

/**
 * Browser error reporting is opt-in: with no DSN configured every call is a
 * no-op. Reports carry the release SHA so a regression can be tied to a deploy.
 *
 * shortcut: reports go to the console instead of a vendor transport. Add the
 * transport here once NEXT_PUBLIC_SENTRY_DSN is set in a real environment.
 */
export function reportClientError(error: unknown, context: ClientErrorContext = {}): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  const release = process.env.NEXT_PUBLIC_RELEASE_SHA?.trim() || "unknown";
  const name = error instanceof Error ? error.constructor.name : "Unknown";
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      event: "client_error",
      release,
      route: context.route ?? (typeof window === "undefined" ? null : window.location.pathname),
      requestId: context.requestId ?? null,
      errorName: name,
      message,
    }),
  );
}
