import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { probePublicPage } from "@yen/shared/telemetry";
import { expect, it } from "vitest";
import { recordRequest } from "./telemetry.js";

it("counts failures and latency breaches for approval, donation and public pages", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);
  try {
    for (const status of [200, 503]) {
      recordRequest("POST", "/v1/funds/:fundId/expenses/:expenseId/approve", status, 100);
      recordRequest("POST", "/v1/funds/:fundId/expenses/:expenseId/pay", status, 100);
      recordRequest("POST", "/v1/funds/:fundId/donations/pledge", status, 100);
      await probePublicPage(
        new URL("https://public.example/funds/demo"),
        async () => new Response(null, { status }),
      );
    }
    recordRequest("POST", "/v1/funds/:fundId/expenses/:expenseId/approve", 200, 1001);
    await provider.forceFlush();
    const points = exporter.getMetrics().flatMap((batch) =>
      batch.scopeMetrics.flatMap((scope) =>
        scope.metrics
          .filter((metric) => metric.descriptor.name === "yen.slo.observations")
          .flatMap((metric) =>
            metric.dataPoints.map((point) => ({
              attributes: point.attributes,
              value: point.value,
            })),
          ),
      ),
    );
    for (const id of [
      "approval_api_availability",
      "approve_p95_latency",
      "pay_p95_latency",
      "donation_recording",
      "public_page_availability",
    ]) {
      expect(points).toContainEqual(
        expect.objectContaining({
          attributes: { "yen.slo.id": id, "yen.slo.good": true },
          value: id === "approval_api_availability" ? 2 : 1,
        }),
      );
      expect(points).toContainEqual(
        expect.objectContaining({
          attributes: { "yen.slo.id": id, "yen.slo.good": false },
          value: id === "approve_p95_latency" ? 2 : 1,
        }),
      );
    }
  } finally {
    await provider.shutdown();
  }
});
