import { monitorEventLoopDelay } from "node:perf_hooks";
import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { recordSaturation } from "./telemetry.js";

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
  const stopLoopMetrics = startEventLoopMetrics();
  return {
    async shutdown() {
      stopLoopMetrics();
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}

export function startEventLoopMetrics(intervalMs = 30000): () => void {
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const timer = setInterval(() => {
    recordSaturation("event_loop.lag", lag.max / 1000000);
    lag.reset();
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    lag.disable();
  };
}
