import {
  buildSentryEnvelope,
  parseSentryDsn,
  scrubText,
  scrubValue,
  sentryEnvelopeHeaders,
} from "@yen/shared";

type ClientErrorContext = {
  readonly route?: string | undefined;
  readonly requestId?: string | undefined;
  readonly extra?: Record<string, unknown> | undefined;
};

type ClientTransport = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<void>;

/** Release SHA from Vercel build env with a NEXT_PUBLIC fallback for other hosts. */
export function clientRelease(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_RELEASE_SHA?.trim() ||
    "unknown"
  );
}

/**
 * Strips query strings and fragments so user inputs typed into URLs never
 * reach a report, then scrubs whatever path text remains.
 */
export function scrubRoute(route: string): string {
  const withoutFragment = route.split("#")[0] ?? route;
  const withoutQuery = withoutFragment.split("?")[0] ?? withoutFragment;
  return scrubText(withoutQuery);
}

const clientTransport: ClientTransport = (url, headers, body) =>
  fetch(url, { method: "POST", headers, body, keepalive: true }).then((response) => {
    if (!response.ok) throw new Error(`sentry envelope rejected: ${response.status}`);
  });

/**
 * Browser error reporting is opt-in: with no DSN configured every call is a
 * no-op. Reports carry the release SHA so a regression can be tied to a
 * deploy, and message, route and extra context are scrubbed of PII before
 * they leave the page.
 */
export function reportClientError(
  error: unknown,
  context: ClientErrorContext = {},
  options: { transport?: ClientTransport; timestamp?: () => string } = {},
): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  const release = clientRelease();
  const name = error instanceof Error ? error.constructor.name : "Unknown";
  const message = error instanceof Error ? error.message : String(error);
  const route = context.route === undefined ? undefined : scrubRoute(context.route);
  const scrubbedMessage = scrubText(message);
  const report = {
    event: "client_error",
    release,
    route: route ?? null,
    requestId: context.requestId ?? null,
    errorName: name,
    message: scrubbedMessage,
    ...(context.extra === undefined ? {} : { extra: scrubValue(context.extra) }),
  };
  console.error(JSON.stringify(report));

  const parsedDsn = parseSentryDsn(dsn);
  if (!parsedDsn) return;
  const transport = options.transport ?? clientTransport;
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  try {
    const eventId = crypto.randomUUID();
    const event = {
      event_id: eventId,
      timestamp: timestamp(),
      platform: "javascript",
      level: "error",
      release,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || "production",
      message: { formatted: scrubbedMessage },
      exception: { values: [{ type: scrubText(name), value: scrubbedMessage }] },
      tags: {
        ...(route === undefined ? {} : { route }),
        ...(context.requestId === undefined ? {} : { request_id: context.requestId }),
      },
      ...(context.extra === undefined ? {} : { extra: scrubValue(context.extra) }),
    };
    void transport(
      parsedDsn.envelopeUrl,
      sentryEnvelopeHeaders(parsedDsn.publicKey, "yen.web/1.0.0"),
      buildSentryEnvelope(eventId, event, timestamp(), "yen.web", "1.0.0"),
    ).catch(() => undefined);
  } catch {
    // Reporting must never break the page that produced the error.
  }
}

const installed = new WeakSet<Window>();

/**
 * Wires global window error and unhandled rejection events into
 * reportClientError. Idempotent per window; returns a cleanup function.
 */
export function installClientObservability(
  target: Window | undefined = globalThis.window,
): () => void {
  if (!target || installed.has(target)) return () => undefined;
  const onError = (event: ErrorEvent) => {
    const error =
      event.error instanceof Error ? event.error : new Error(event.message || "unhandled error");
    reportClientError(error, { route: target.location.pathname });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientError(reason instanceof Error ? reason : new Error("unhandled promise rejection"), {
      route: target.location.pathname,
    });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  installed.add(target);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    installed.delete(target);
  };
}
