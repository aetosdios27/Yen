import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { Sql } from "@yen/db";
import { expect, it, vi } from "vitest";
import { sampleMoneyTelemetry } from "./telemetry.js";

for (const failed of [0, 1, 2, 3])
  it(`exports failure of statement ${failed} and still observes independent measurements`, async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
    });
    metrics.disable();
    metrics.setGlobalMeterProvider(provider);
    let calls = 0;
    const sql = ((parts: TemplateStringsArray | string) => {
      if (typeof parts === "string") return parts;
      if (calls++ === failed)
        return Promise.reject(
          Object.assign(new Error("private@example.com +919876543210"), { code: "ECONNREFUSED" }),
        );
      return Promise.resolve([]);
    }) as unknown as Sql;
    const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await sampleMoneyTelemetry(sql, "pgboss");
      await provider.forceFlush();
      const all = exporter.getMetrics().flatMap((b) => b.scopeMetrics.flatMap((s) => s.metrics));
      expect(calls).toBe(4);
      const failure = all.find((m) => m.descriptor.name === "yen.telemetry.sampler_failures");
      expect(failure?.dataPoints[0]?.value).toBe(1);
      const points = all
        .filter((m) => m.descriptor.name === "yen.slo.observations")
        .flatMap((m) => m.dataPoints.map((p) => ({ attributes: p.attributes, value: p.value })));
      expect(points).toHaveLength(failed < 2 ? 1 : 2);
      expect(log.mock.calls.flat().join("")).toContain("name=Error code=ECONNREFUSED");
      expect(log.mock.calls.flat().join("")).not.toContain("private@example.com");
    } finally {
      log.mockRestore();
      await provider.shutdown();
    }
  });
