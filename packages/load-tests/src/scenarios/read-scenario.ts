import {
  type BudgetCheckResult,
  evaluateBudget,
  READ_BUDGET,
  type ScenarioMetrics,
} from "../budgets.js";
import { runAutocannon } from "../client.js";

export interface ReadScenarioOptions {
  baseUrl: string;
  fundId?: string | undefined;
  duration?: number | undefined;
  connections?: number | undefined;
}

export interface ScenarioExecutionResult {
  metrics: ScenarioMetrics;
  budgetCheck: BudgetCheckResult;
}

export const DEFAULT_FUND_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Scenario 1 (Read-heavy):
 * Exercises high-throughput read paths:
 * - GET /health (Liveness)
 * - GET /v1/funds/{fundId} (Fund summary)
 * - GET /funds/{fundId} (Public fund transparency SSR page)
 *
 * Performance budget:
 * - p95 < 50ms, p99 < 150ms
 * - Error rate: 0.00%
 */
export async function runReadScenario(
  options: ReadScenarioOptions,
): Promise<ScenarioExecutionResult> {
  const fundId = options.fundId ?? DEFAULT_FUND_ID;
  const requests = [
    { method: "GET" as const, path: "/health" },
    { method: "GET" as const, path: `/v1/funds/${fundId}` },
    { method: "GET" as const, path: `/funds/${fundId}` },
  ];

  const { metrics } = await runAutocannon({
    scenarioName: "Read-heavy",
    url: options.baseUrl,
    duration: options.duration ?? 5,
    connections: options.connections ?? 10,
    requests,
  });

  const budgetCheck = evaluateBudget(metrics, READ_BUDGET);

  return { metrics, budgetCheck };
}
