/**
 * Performance budgets as code.
 *
 * Defines explicit service level thresholds for latency and error rates
 * across read-heavy, write-heavy, and auth scenarios.
 */

export interface PerformanceBudget {
  readonly scenario: string;
  readonly p95MaxMs: number;
  readonly p99MaxMs: number;
  readonly maxErrorRate: number; // 0.00% = 0.0
}

export const READ_BUDGET: PerformanceBudget = {
  scenario: "read",
  p95MaxMs: 50,
  p99MaxMs: 150,
  maxErrorRate: 0.0,
};

export const WRITE_BUDGET: PerformanceBudget = {
  scenario: "write",
  p95MaxMs: 120,
  p99MaxMs: 300,
  maxErrorRate: 0.0,
};

export const AUTH_BUDGET: PerformanceBudget = {
  scenario: "auth",
  p95MaxMs: 50,
  p99MaxMs: 150,
  maxErrorRate: 0.0,
};

export interface ScenarioMetrics {
  readonly scenario: string;
  readonly requestsTotal: number;
  readonly requestsPerSecond: number;
  readonly p50LatencyMs: number;
  readonly p90LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly maxLatencyMs: number;
  readonly errorCount: number;
  readonly non2xxCount: number;
  readonly errorRate: number; // 0.0 to 1.0
}

export interface BudgetCheckResult {
  readonly passed: boolean;
  readonly scenario: string;
  readonly checks: {
    readonly metric: string;
    readonly actual: number;
    readonly budget: number;
    readonly unit: string;
    readonly passed: boolean;
  }[];
}

/**
 * Validates scenario performance metrics against an explicit budget.
 */
export function evaluateBudget(
  metrics: ScenarioMetrics,
  budget: PerformanceBudget,
): BudgetCheckResult {
  const p95Passed = metrics.p95LatencyMs <= budget.p95MaxMs;
  const p99Passed = metrics.p99LatencyMs <= budget.p99MaxMs;
  const errorRatePassed = metrics.errorRate <= budget.maxErrorRate;

  return {
    passed: p95Passed && p99Passed && errorRatePassed,
    scenario: metrics.scenario,
    checks: [
      {
        metric: "p95 Latency",
        actual: metrics.p95LatencyMs,
        budget: budget.p95MaxMs,
        unit: "ms",
        passed: p95Passed,
      },
      {
        metric: "p99 Latency",
        actual: metrics.p99LatencyMs,
        budget: budget.p99MaxMs,
        unit: "ms",
        passed: p99Passed,
      },
      {
        metric: "Error Rate",
        actual: metrics.errorRate,
        budget: budget.maxErrorRate,
        unit: "%",
        passed: errorRatePassed,
      },
    ],
  };
}

/**
 * Returns the default budget for a given scenario name.
 */
export function getBudgetForScenario(scenario: string): PerformanceBudget {
  switch (scenario.toLowerCase()) {
    case "read":
      return READ_BUDGET;
    case "write":
      return WRITE_BUDGET;
    case "auth":
      return AUTH_BUDGET;
    default:
      return READ_BUDGET;
  }
}
