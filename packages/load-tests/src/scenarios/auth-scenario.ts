import { AUTH_BUDGET, evaluateBudget } from "../budgets.js";
import { runAutocannon } from "../client.js";
import type { ScenarioExecutionResult } from "./read-scenario.js";

export interface AuthScenarioOptions {
  baseUrl: string;
  token?: string | undefined;
  duration?: number | undefined;
  connections?: number | undefined;
}

export const DEFAULT_AUTH_TOKEN = "valid-session-test-token-0001";

/**
 * Scenario 3 (Auth/Session):
 * Exercises authenticated session validation paths:
 * - GET /v1/me with Authorization Bearer header
 *
 * Performance budget:
 * - p95 < 50ms, p99 < 150ms
 * - Error rate: 0.00%
 */
export async function runAuthScenario(
  options: AuthScenarioOptions,
): Promise<ScenarioExecutionResult> {
  const token = options.token ?? DEFAULT_AUTH_TOKEN;
  const targetPath = "/v1/me";

  const { metrics } = await runAutocannon({
    scenarioName: "Auth / Session Validation",
    url: `${options.baseUrl}${targetPath}`,
    method: "GET",
    duration: options.duration ?? 5,
    connections: options.connections ?? 10,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const budgetCheck = evaluateBudget(metrics, AUTH_BUDGET);

  return { metrics, budgetCheck };
}
