import { describe, expect, it } from "vitest";
import { evaluateExitCriteria, type QueueMetrics } from "./evaluator.js";

describe("evaluateExitCriteria", () => {
  it("keeps pg-boss when all metrics are within acceptable thresholds", () => {
    const metrics: QueueMetrics = {
      queueName: "notifications",
      queueDepth: 500,
      queueDepthSustainedSeconds: 60,
      p99LatencyMs: 800,
      workflowDurationSeconds: 10,
      databaseCpuPercent: 5,
      databaseIopsPercent: 8,
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.recommendedEngine).toBe("pg-boss");
    expect(result.currentEngine).toBe("pg-boss");
  });

  it("triggers exit to BullMQ when notification queue depth is sustained above threshold", () => {
    const metrics: QueueMetrics = {
      queueName: "notifications",
      queueDepth: 12000,
      queueDepthSustainedSeconds: 1000, // exceeds 900s limit
      p99LatencyMs: 1500,
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(true);
    expect(result.recommendedEngine).toBe("BullMQ");
    expect(result.reasons[0]).toContain("Queue depth 12000 exceeds maximum threshold 10000");
  });

  it("does not trigger exit when queue depth spike is brief and not sustained", () => {
    const metrics: QueueMetrics = {
      queueName: "notifications",
      queueDepth: 15000,
      queueDepthSustainedSeconds: 120, // below 900s sustained threshold
      p99LatencyMs: 2000,
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(false);
    expect(result.recommendedEngine).toBe("pg-boss");
  });

  it("triggers exit when notification latency exceeds P99 limit", () => {
    const metrics: QueueMetrics = {
      queueName: "notifications",
      queueDepth: 200,
      p99LatencyMs: 6500, // exceeds 5000ms
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(true);
    expect(result.recommendedEngine).toBe("BullMQ");
    expect(result.reasons).toContain("P99 latency 6500ms exceeds maximum threshold 5000ms.");
  });

  it("triggers exit to Temporal when blockchain-anchoring workflow duration exceeds limit", () => {
    const metrics: QueueMetrics = {
      queueName: "blockchain-anchoring",
      queueDepth: 10,
      p99LatencyMs: 500,
      workflowDurationSeconds: 100000, // exceeds 86400s (24h)
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(true);
    expect(result.recommendedEngine).toBe("Temporal");
    expect(result.reasons[0]).toContain(
      "Workflow duration 100000s exceeds maximum threshold 86400s.",
    );
  });

  it("triggers exit to Temporal when workflow steps exceed orchestration limit", () => {
    const metrics: QueueMetrics = {
      queueName: "blockchain-anchoring",
      queueDepth: 20,
      p99LatencyMs: 1000,
      workflowDurationSeconds: 1200,
      workflowSteps: 15, // exceeds 10 steps
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(true);
    expect(result.recommendedEngine).toBe("Temporal");
    expect(result.reasons[0]).toContain(
      "Workflow steps 15 exceeds orchestration threshold 10 steps.",
    );
  });

  it("triggers exit when global database CPU exceeds saturation threshold", () => {
    const metrics: QueueMetrics = {
      queueName: "reconciliation",
      queueDepth: 50,
      p99LatencyMs: 1000,
      databaseCpuPercent: 35, // exceeds 25%
    };

    const result = evaluateExitCriteria(metrics);
    expect(result.exceeded).toBe(true);
    expect(result.recommendedEngine).toBe("Temporal");
    expect(result.reasons).toContain("Database CPU saturation 35% exceeds threshold 25%.");
  });

  it("throws when evaluated against an unregistered queue", () => {
    const metrics: QueueMetrics = {
      queueName: "unknown-queue",
      queueDepth: 10,
      p99LatencyMs: 100,
    };

    expect(() => evaluateExitCriteria(metrics)).toThrow(
      "Queue 'unknown-queue' has no defined exit criteria thresholds.",
    );
  });
});
