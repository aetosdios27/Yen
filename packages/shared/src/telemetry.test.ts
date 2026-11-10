import { metrics, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { expect, it } from "vitest";
import { startEventLoopMetrics } from "./observability.js";
import { SLOS } from "./slo.js";
import { jobTelemetry, observeObjective, traceJob, withTelemetrySpan } from "./telemetry.js";

it("counts a bad observation for every objective and propagates only trace context to jobs", async () => {
  const spans = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
  trace.disable();
  provider.register();
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meter = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(meter);
  try {
    for (const slo of SLOS) observeObjective(slo.id, false);
    let carrier: ReturnType<typeof jobTelemetry> = {};
    await withTelemetrySpan("browser.request", async () => {
      carrier = jobTelemetry();
    });
    await traceJob(carrier, async () => undefined);
    const personal =
      "Private Person private@example.com private@yenbank +919876543210 Bearer secret-token";
    await expect(
      traceJob(carrier, async () => {
        throw new Error(personal);
      }),
    ).rejects.toThrow(personal);
    const stopLoopMetrics = startEventLoopMetrics(40);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const until = performance.now() + 60;
      while (performance.now() < until) {
        /* Deliberately stall the event loop. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      stopLoopMetrics();
    }
    await meter.forceFlush();
    const points = exporter.getMetrics().flatMap((batch) =>
      batch.scopeMetrics.flatMap((scope) =>
        scope.metrics.flatMap((metric) =>
          metric.dataPoints.map((point) => ({
            attributes: point.attributes,
            value: point.value,
          })),
        ),
      ),
    );
    for (const slo of SLOS)
      expect(points).toContainEqual(
        expect.objectContaining({
          attributes: { "yen.slo.id": slo.id, "yen.slo.good": false },
          value: 1,
        }),
      );
    const finished = spans.getFinishedSpans();
    expect(finished.map((s) => s.spanContext().traceId)).toEqual([
      finished[0]?.spanContext().traceId,
      finished[0]?.spanContext().traceId,
      finished[0]?.spanContext().traceId,
    ]);
    expect(
      JSON.stringify(
        finished.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      ),
    ).not.toContain(personal);
    expect(
      points.some(
        (point) =>
          typeof point.value === "object" && "max" in point.value && Number(point.value.max) >= 40,
      ),
    ).toBe(true);
    expect(Object.keys(carrier)).toEqual(["traceparent"]);
  } finally {
    await meter.shutdown();
    await provider.shutdown();
  }
});
