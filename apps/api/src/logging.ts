import { z } from "zod";

const requestLog = z.object({
  event: z.literal("http_request"),
  requestId: z.string().uuid(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "OTHER"]),
  route: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
});
const failureLog = z.object({
  event: z.literal("http_failure"),
  requestId: z.string().uuid(),
  method: requestLog.shape.method,
  route: z.string(),
  errorKind: z.enum(["readiness", "store", "handler", "validation", "unknown"]),
  errorName: z.string(),
});

export type RequestLog = z.infer<typeof requestLog>;
export type FailureLog = z.infer<typeof failureLog>;
export type LogEntry = RequestLog | FailureLog;
const logEntry = z.discriminatedUnion("event", [requestLog, failureLog]);

export function logMethod(value: string): RequestLog["method"] {
  const parsed = requestLog.shape.method.safeParse(value);
  return parsed.success ? parsed.data : "OTHER";
}

export interface Logger {
  log(entry: LogEntry): void;
}

export function serializeRequestLog(entry: LogEntry): string {
  return JSON.stringify(logEntry.parse(entry));
}

export const jsonLogger: Logger = {
  log: (entry) => process.stdout.write(`${serializeRequestLog(entry)}\n`),
};
