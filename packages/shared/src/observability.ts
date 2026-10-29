import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** Export is opt-in. With no endpoint, OTel API's no-op provider keeps request overhead minimal. */
export function startObservability(endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  if (!endpoint) return undefined;
  const baseUrl = endpoint.replace(/\/$/, "");
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${baseUrl}/v1/traces` })),
    ],
  });
  tracerProvider.register();
  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  return {
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
