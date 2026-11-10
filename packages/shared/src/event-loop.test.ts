import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { expect, it, vi } from "vitest";
import { startEventLoopMetrics } from "./observability.js";

it("records injected delay readings at each interval and flushes the final reading on stop", async () => {
  vi.useFakeTimers();
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meter = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(meter);
  const lag = { max: 60000000, enable: vi.fn(), disable: vi.fn(), reset: vi.fn() };
  try {
    const stop = startEventLoopMetrics(40, lag);
    vi.advanceTimersByTime(40);
    expect(lag.reset).toHaveBeenCalledTimes(1);
    lag.max = 80000000;
    stop();
    expect(lag.disable).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(lag.reset).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    await meter.forceFlush();
    const points = exporter
      .getMetrics()
      .flatMap((b) =>
        b.scopeMetrics.flatMap((s) =>
          s.metrics
            .filter((m) => m.descriptor.name === "yen.event_loop.lag")
            .flatMap((m) =>
              m.dataPoints.map((p) => ({ attributes: p.attributes, value: p.value })),
            ),
        ),
      );
    expect(points).toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ max: 80, min: 60, count: 2 }) }),
    );
  } finally {
    vi.useRealTimers();
    await meter.shutdown();
  }
});
