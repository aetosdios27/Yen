import { expect, it } from "vitest";
import { startObservability } from "./observability.js";
import { startRequestSpan } from "./telemetry.js";

it("keeps telemetry export disabled without an endpoint or recording overhead", async () => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  try {
    expect(await startObservability()).toBeUndefined();
    const span = startRequestSpan("disabled.trace");
    expect(span.isRecording()).toBe(false);
    span.end();
  } finally {
    if (endpoint !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
  }
});
