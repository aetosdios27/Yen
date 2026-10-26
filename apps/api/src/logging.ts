import { z } from "zod";

const requestLog = z.object({
  event: z.literal("http_request"),
  requestId: z.string().uuid(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "OTHER"]),
  route: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
});

export type RequestLog = z.infer<typeof requestLog>;

export interface Logger {
  log(entry: RequestLog): void;
}

export function serializeRequestLog(entry: RequestLog): string {
  return JSON.stringify(requestLog.parse(entry));
}

export const jsonLogger: Logger = {
  log: (entry) => process.stdout.write(`${serializeRequestLog(entry)}\n`),
};
