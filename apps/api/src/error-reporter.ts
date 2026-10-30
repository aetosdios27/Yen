import { redactLogText } from "./logging.js";

export type ErrorReportContext = {
  readonly requestId: string;
  readonly route: string;
  readonly status: number;
  readonly traceId?: string | undefined;
};

export interface ErrorReporter {
  capture: (error: unknown, context: ErrorReportContext) => void;
}

export type ErrorReporterOptions = {
  readonly dsn?: string | undefined;
  readonly release?: string | undefined;
  readonly environment?: string | undefined;
  readonly write?: (line: string) => void;
};

const noopReporter: ErrorReporter = { capture: () => undefined };

/**
 * Error reporting is opt-in: without a DSN every capture is a no-op.
 *
 * shortcut: reports go to the log stream tagged with release and request ids
 * instead of a vendor SDK. Wire the Sentry transport here when a DSN is in use
 * in production, and keep the redaction this function already applies.
 */
export function createErrorReporter(options: ErrorReporterOptions = {}): ErrorReporter {
  const dsn = options.dsn?.trim();
  if (!dsn) return noopReporter;
  const release = options.release?.trim() || "unknown";
  const environment = options.environment?.trim() || "development";
  const write = options.write ?? ((line: string) => process.stdout.write(line));

  return {
    capture: (error, context) => {
      const name = error instanceof Error ? error.constructor.name : "Unknown";
      const message = error instanceof Error ? error.message : String(error);
      write(
        `${JSON.stringify({
          event: "error_report",
          release,
          environment,
          requestId: context.requestId,
          traceId: context.traceId ?? null,
          route: redactLogText(context.route),
          status: context.status,
          errorName: redactLogText(name),
          message: redactLogText(message),
        })}\n`,
      );
    },
  };
}
