import { jobTelemetry } from "@yen/shared/telemetry";

export interface JobEnvelope<T> {
  __yenTelemetry: ReturnType<typeof jobTelemetry>;
  payload: T;
}
export function wrapJobPayload<T>(payload: T): JobEnvelope<T> {
  return { __yenTelemetry: jobTelemetry(), payload };
}
export function unwrapJobPayload(input: unknown): { payload: unknown; carrier: unknown } {
  if (typeof input === "object" && input !== null && "__yenTelemetry" in input) {
    if ("payload" in input) return { payload: input.payload, carrier: input.__yenTelemetry };
    throw new TypeError("Invalid job envelope");
  }
  return { payload: input, carrier: {} };
}
