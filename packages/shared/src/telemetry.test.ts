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
import { SLOS } from "./slo.js";
import { jobTelemetry, observeObjective, traceJob, withTelemetrySpan } from "./telemetry.js";

it("counts a bad observation for every objective", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meter = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(meter);
  try {
    for (const slo of SLOS) observeObjective(slo.id, false);
    await meter.forceFlush();
    const points = exporter
      .getMetrics()
      .flatMap((b) =>
        b.scopeMetrics.flatMap((s) =>
          s.metrics.flatMap((m) =>
            m.dataPoints.map((p) => ({ attributes: p.attributes, value: p.value })),
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
  } finally {
    await meter.shutdown();
  }
});

function spanProvider() {
  const spans = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
  trace.disable();
  provider.register();
  return { spans, provider };
}

it("propagates only trace context to jobs in one trace", async () => {
  const { spans, provider } = spanProvider();
  try {
    let carrier: ReturnType<typeof jobTelemetry> = {};
    await withTelemetrySpan("browser.request", async () => {
      carrier = jobTelemetry();
    });
    await traceJob(carrier, async () => undefined);
    const finished = spans.getFinishedSpans();
    expect(finished).toHaveLength(2);
    expect(finished[1]?.spanContext().traceId).toBe(finished[0]?.spanContext().traceId);
    expect(Object.keys(carrier)).toEqual(["traceparent"]);
  } finally {
    await provider.shutdown();
  }
});

it("does not export personal exception data in job spans", async () => {
  const { spans, provider } = spanProvider();
  const personal = "private@example.com +919876543210 Bearer secret-token";
  try {
    await expect(
      traceJob({}, async () => {
        throw new Error(personal);
      }),
    ).rejects.toThrow(personal);
    expect(spans.getFinishedSpans()).toHaveLength(1);
    expect(
      JSON.stringify(
        spans
          .getFinishedSpans()
          .map((s) => ({ attributes: s.attributes, events: s.events, status: s.status })),
      ),
    ).not.toContain(personal);
  } finally {
    await provider.shutdown();
  }
});

it("caller rejection preserves the availability budget while service failures burn it", async () => {
  const { measuredObjective } = await import("./telemetry.js");
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meter = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(meter);
  try {
    for (const error of [new TypeError("caller"), new Error("service")]) {
      await expect(
        measuredObjective(
          "event_append",
          async () => {
            throw error;
          },
          (e) => !(e instanceof TypeError),
        ),
      ).rejects.toThrow(error);
    }
    await meter.forceFlush();
    const points = exporter
      .getMetrics()
      .flatMap((b) =>
        b.scopeMetrics.flatMap((s) =>
          s.metrics.flatMap((m) =>
            m.dataPoints.map((p) => ({ attributes: p.attributes, value: p.value })),
          ),
        ),
      );
    for (const good of [true, false])
      expect(points).toContainEqual(
        expect.objectContaining({
          attributes: { "yen.slo.id": "event_append", "yen.slo.good": good },
          value: 1,
        }),
      );
  } finally {
    await meter.shutdown();
  }
});
