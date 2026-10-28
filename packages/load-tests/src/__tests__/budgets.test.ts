import { describe, expect, it } from "vitest";
import {
  AUTH_BUDGET,
  evaluateBudget,
  getBudgetForScenario,
  READ_BUDGET,
  WRITE_BUDGET,
} from "../budgets.js";

describe("Performance Budgets", () => {
  it("defines read budget with p95 < 50ms and p99 < 150ms", () => {
    expect(READ_BUDGET.p95MaxMs).toBe(50);
    expect(READ_BUDGET.p99MaxMs).toBe(150);
    expect(READ_BUDGET.maxErrorRate).toBe(0.0);
  });

  it("defines write budget with p95 < 120ms and p99 < 300ms", () => {
    expect(WRITE_BUDGET.p95MaxMs).toBe(120);
    expect(WRITE_BUDGET.p99MaxMs).toBe(300);
    expect(WRITE_BUDGET.maxErrorRate).toBe(0.0);
  });

  it("defines auth budget with p95 < 50ms and p99 < 150ms", () => {
    expect(AUTH_BUDGET.p95MaxMs).toBe(50);
    expect(AUTH_BUDGET.p99MaxMs).toBe(150);
    expect(AUTH_BUDGET.maxErrorRate).toBe(0.0);
  });

  it("passes when all metrics are within budget", () => {
    const result = evaluateBudget(
      {
        scenario: "read",
        requestsTotal: 5000,
        requestsPerSecond: 1000,
        p50LatencyMs: 1.2,
        p90LatencyMs: 4.5,
        p95LatencyMs: 8.0,
        p99LatencyMs: 22.0,
        maxLatencyMs: 45.0,
        errorCount: 0,
        non2xxCount: 0,
        errorRate: 0.0,
      },
      READ_BUDGET,
    );

    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when p95 exceeds budget", () => {
    const result = evaluateBudget(
      {
        scenario: "read",
        requestsTotal: 5000,
        requestsPerSecond: 1000,
        p50LatencyMs: 10.0,
        p90LatencyMs: 45.0,
        p95LatencyMs: 55.0, // > 50ms
        p99LatencyMs: 120.0,
        maxLatencyMs: 140.0,
        errorCount: 0,
        non2xxCount: 0,
        errorRate: 0.0,
      },
      READ_BUDGET,
    );

    expect(result.passed).toBe(false);
    const p95Check = result.checks.find((c) => c.metric === "p95 Latency");
    expect(p95Check?.passed).toBe(false);
  });

  it("fails when p99 exceeds budget", () => {
    const result = evaluateBudget(
      {
        scenario: "write",
        requestsTotal: 2000,
        requestsPerSecond: 400,
        p50LatencyMs: 15.0,
        p90LatencyMs: 60.0,
        p95LatencyMs: 95.0,
        p99LatencyMs: 320.0, // > 300ms
        maxLatencyMs: 450.0,
        errorCount: 0,
        non2xxCount: 0,
        errorRate: 0.0,
      },
      WRITE_BUDGET,
    );

    expect(result.passed).toBe(false);
    const p99Check = result.checks.find((c) => c.metric === "p99 Latency");
    expect(p99Check?.passed).toBe(false);
  });

  it("fails when error rate exceeds 0.00%", () => {
    const result = evaluateBudget(
      {
        scenario: "auth",
        requestsTotal: 1000,
        requestsPerSecond: 200,
        p50LatencyMs: 5.0,
        p90LatencyMs: 12.0,
        p95LatencyMs: 20.0,
        p99LatencyMs: 40.0,
        maxLatencyMs: 60.0,
        errorCount: 1,
        non2xxCount: 0,
        errorRate: 0.1, // > 0.0%
      },
      AUTH_BUDGET,
    );

    expect(result.passed).toBe(false);
    const errorCheck = result.checks.find((c) => c.metric === "Error Rate");
    expect(errorCheck?.passed).toBe(false);
  });

  it("resolves the correct budget by scenario name", () => {
    expect(getBudgetForScenario("read")).toEqual(READ_BUDGET);
    expect(getBudgetForScenario("write")).toEqual(WRITE_BUDGET);
    expect(getBudgetForScenario("auth")).toEqual(AUTH_BUDGET);
  });
});
