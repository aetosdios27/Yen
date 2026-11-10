import { randomUUID } from "node:crypto";
import { scrubText, scrubValue } from "@yen/shared";
import { redactLogText } from "./logging.js";

export type ErrorReportContext = {
  readonly requestId: string;
  readonly route: string;
  readonly status: number;
  readonly traceId?: string | undefined;
  readonly extra?: Record<string, unknown> | undefined;
};

export interface ErrorReporter {
  capture: (error: unknown, context: ErrorReportContext) => void;
}

export type ErrorTransport = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<void>;

export type ErrorReporterOptions = {
  readonly dsn?: string | undefined;
  readonly release?: string | undefined;
  readonly environment?: string | undefined;
  readonly write?: (line: string) => void;
  readonly transport?: ErrorTransport;
  readonly timestamp?: () => string;
};

const noopReporter: ErrorReporter = { capture: () => undefined };

export type ParsedSentryDsn = {
  readonly envelopeUrl: string;
  readonly publicKey: string;
};

/**
 * Extracts the envelope endpoint and public key from a DSN of the form
 * https://<publicKey>@<host>/<projectId>. Null for anything else, so a
 * malformed DSN degrades to the stdout reporter instead of throwing.
 */
export function parseSentryDsn(dsn: string): ParsedSentryDsn | null {
  const match =
    /^(?<protocol>https?):\/\/(?<publicKey>[^@\s]+)@(?<host>[^/\s]+)\/(?<projectId>\d+)$/.exec(
      dsn.trim(),
    );
  const groups = match?.groups;
  if (!groups?.protocol || !groups.publicKey || !groups.host || !groups.projectId) return null;
  return {
    envelopeUrl: `${groups.protocol}://${groups.host}/api/${groups.projectId}/envelope/`,
    publicKey: groups.publicKey,
  };
}

const defaultTransport: ErrorTransport = (url, headers, body) =>
  fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) }).then(
    (response) => {
      if (!response.ok) throw new Error(`sentry envelope rejected: ${response.status}`);
    },
  );

function sentryHeaders(publicKey: string): Record<string, string> {
  return {
    "content-type": "application/x-sentry-envelope",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_client=yen-api/1.0.0, sentry_key=${publicKey}`,
  };
}

function buildEnvelope(eventId: string, event: Record<string, unknown>): string {
  const header = {
    event_id: eventId,
    sent_at: new Date().toISOString(),
    sdk: { name: "yen.api", version: "1.0.0" },
  };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

function stdoutLine(
  release: string,
  environment: string,
  context: ErrorReportContext,
  name: string,
  message: string,
): string {
  return `${JSON.stringify({
    event: "error_report",
    release,
    environment,
    requestId: context.requestId,
    traceId: context.traceId ?? null,
    route: redactLogText(context.route),
    status: context.status,
    errorName: redactLogText(name),
    message: redactLogText(message),
    ...(context.extra === undefined ? {} : { extra: scrubValue(context.extra) }),
  })}\n`;
}

/**
 * Error reporting is opt-in: without a DSN every capture is a no-op.
 *
 * With a DSN the scrubbed report goes to the Sentry envelope endpoint,
 * tagged with the release SHA and request metadata. Captures are never
 * awaited and a transport failure falls back to the scrubbed stdout line,
 * so an outage of the error pipeline cannot lose the error or break the
 * request that produced it.
 */
export function createErrorReporter(options: ErrorReporterOptions = {}): ErrorReporter {
  const dsn = options.dsn?.trim();
  if (!dsn) return noopReporter;
  const parsedDsn = parseSentryDsn(dsn);
  if (!parsedDsn) {
    return createStdoutErrorReporter(options);
  }
  const release = options.release?.trim() || "unknown";
  const environment = options.environment?.trim() || "development";
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const transport = options.transport ?? defaultTransport;
  const timestamp = options.timestamp ?? (() => new Date().toISOString());

  return {
    capture: (error, context) => {
      try {
        const name = error instanceof Error ? error.constructor.name : "Unknown";
        const message = error instanceof Error ? error.message : String(error);
        const eventId = randomUUID();
        const event: Record<string, unknown> = {
          event_id: eventId,
          timestamp: timestamp(),
          platform: "node",
          level: "error",
          release,
          environment,
          message: { formatted: scrubText(message) },
          exception: { values: [{ type: scrubText(name), value: scrubText(message) }] },
          tags: {
            request_id: context.requestId,
            route: scrubText(context.route),
            status: String(context.status),
            ...(context.traceId === undefined ? {} : { trace_id: context.traceId }),
          },
          ...(context.extra === undefined ? {} : { extra: scrubValue(context.extra) }),
        };
        transport(
          parsedDsn.envelopeUrl,
          sentryHeaders(parsedDsn.publicKey),
          buildEnvelope(eventId, event),
        ).catch(() => {
          try {
            write(stdoutLine(release, environment, context, name, message));
          } catch {
            // The stdout fallback itself must not throw out of capture.
          }
        });
      } catch {
        // Reporting must never take down the request that produced the error.
      }
    },
  };
}

/** Log-stream fallback used when no usable DSN is configured or dispatch fails. */
export function createStdoutErrorReporter(options: ErrorReporterOptions = {}): ErrorReporter {
  const release = options.release?.trim() || "unknown";
  const environment = options.environment?.trim() || "development";
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  return {
    capture: (error, context) => {
      try {
        const name = error instanceof Error ? error.constructor.name : "Unknown";
        const message = error instanceof Error ? error.message : String(error);
        write(stdoutLine(release, environment, context, name, message));
      } catch {
        // Reporting must never take down the request that produced the error.
      }
    },
  };
}
