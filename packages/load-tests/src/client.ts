import autocannon, { type Options, type Result } from "autocannon";
import type { ScenarioMetrics } from "./budgets.js";

export interface LoadRunOptions {
  scenarioName: string;
  url: string;
  duration?: number | undefined;
  connections?: number | undefined;
  pipelining?: number | undefined;
  setupClient?: ((client: autocannon.Client) => void) | undefined;
  requests?: autocannon.Request[] | undefined;
  headers?: Record<string, string> | undefined;
  method?: autocannon.Request["method"] | undefined;
  body?: string | undefined;
}

/**
 * Runs an Autocannon load test scenario and transforms the result into typed ScenarioMetrics.
 */
export async function runAutocannon(options: LoadRunOptions): Promise<{
  metrics: ScenarioMetrics;
  raw: Result;
}> {
  const autocannonOpts: Options = {
    url: options.url,
    connections: options.connections ?? 10,
    duration: options.duration ?? 5,
    pipelining: options.pipelining ?? 1,
    method: options.method ?? "GET",
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body ? { body: options.body } : {}),
    ...(options.requests ? { requests: options.requests } : {}),
    ...(options.setupClient ? { setupClient: options.setupClient } : {}),
  };

  const raw: Result = await autocannon(autocannonOpts);

  const requestsTotal = raw.requests.total ?? 0;
  const requestsPerSecond = raw.requests.average ?? 0;
  const p50LatencyMs = raw.latency.p50 ?? 0;
  const p90LatencyMs = raw.latency.p90 ?? 0;
  // Autocannon captures p90 and p97_5; compute p95 via interpolation between p90 and p97_5
  const latencyRecord = raw.latency as unknown as Record<string, number | undefined>;
  const p97_5LatencyMs = latencyRecord.p97_5 ?? p90LatencyMs;
  const p95LatencyMs =
    p97_5LatencyMs >= p90LatencyMs
      ? p90LatencyMs + (p97_5LatencyMs - p90LatencyMs) * (5 / 7.5)
      : p90LatencyMs;
  const p99LatencyMs = raw.latency.p99 ?? 0;
  const maxLatencyMs = raw.latency.max ?? 0;

  const errorCount = (raw.errors ?? 0) + (raw.timeouts ?? 0);
  const non2xxCount = raw.non2xx ?? 0;
  const totalFailed = errorCount + non2xxCount;
  const errorRate = requestsTotal > 0 ? (totalFailed / requestsTotal) * 100 : 0.0;

  const metrics: ScenarioMetrics = {
    scenario: options.scenarioName,
    requestsTotal,
    requestsPerSecond,
    p50LatencyMs,
    p90LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    maxLatencyMs,
    errorCount,
    non2xxCount,
    errorRate,
  };

  return { metrics, raw };
}
