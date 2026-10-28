import * as z from "zod";
import defaultCriteria from "./exit-criteria.json" with { type: "json" };

export const queueThresholdsSchema = z.object({
  maxQueueDepth: z.number().positive(),
  maxQueueDepthSustainedSeconds: z.number().positive(),
  maxP99LatencyMs: z.number().positive(),
  maxWorkflowDurationSeconds: z.number().positive(),
  maxWorkflowSteps: z.number().positive().optional(),
});

export type QueueThresholds = z.infer<typeof queueThresholdsSchema>;

export const queueConfigSchema = z.object({
  shape: z.enum(["short_idempotent", "scheduled_batches", "long_lived_anchoring"]),
  targetEngine: z.enum(["BullMQ", "Temporal"]),
  thresholds: queueThresholdsSchema,
});

export type QueueConfig = z.infer<typeof queueConfigSchema>;

export const exitCriteriaConfigSchema = z.object({
  version: z.string(),
  currentEngine: z.literal("pg-boss"),
  queues: z.record(z.string(), queueConfigSchema),
  global: z.object({
    maxDatabaseCpuPercent: z.number().min(0).max(100),
    maxDatabaseIopsPercent: z.number().min(0).max(100),
  }),
});

export type ExitCriteriaConfig = z.infer<typeof exitCriteriaConfigSchema>;

export interface QueueMetrics {
  queueName: string;
  queueDepth: number;
  queueDepthSustainedSeconds?: number;
  p99LatencyMs: number;
  workflowDurationSeconds?: number;
  workflowSteps?: number;
  databaseCpuPercent?: number;
  databaseIopsPercent?: number;
}

export interface EvaluationResult {
  exceeded: boolean;
  reasons: string[];
  recommendedEngine: "pg-boss" | "BullMQ" | "Temporal";
  currentEngine: "pg-boss";
}

export const DEFAULT_EXIT_CRITERIA: ExitCriteriaConfig =
  exitCriteriaConfigSchema.parse(defaultCriteria);

/**
 * Evaluates observed queue metrics against exit criteria thresholds.
 *
 * If metrics exceed defined operational limits, returns exceeded: true
 * with explicit reasons and the recommended target engine.
 */
export function evaluateExitCriteria(
  metrics: QueueMetrics,
  config: ExitCriteriaConfig = DEFAULT_EXIT_CRITERIA,
): EvaluationResult {
  const reasons: string[] = [];
  const queueConfig = config.queues[metrics.queueName];
  let recommendedEngine: "pg-boss" | "BullMQ" | "Temporal" = "pg-boss";

  if (!queueConfig) {
    throw new Error(`Queue '${metrics.queueName}' has no defined exit criteria thresholds.`);
  }

  const { thresholds, targetEngine } = queueConfig;

  // 1. Queue Depth (Backlog)
  if (metrics.queueDepth > thresholds.maxQueueDepth) {
    const sustained = metrics.queueDepthSustainedSeconds ?? 0;
    if (sustained >= thresholds.maxQueueDepthSustainedSeconds) {
      reasons.push(
        `Queue depth ${metrics.queueDepth} exceeds maximum threshold ${thresholds.maxQueueDepth} for sustained ${sustained}s (limit: ${thresholds.maxQueueDepthSustainedSeconds}s).`,
      );
      recommendedEngine = targetEngine;
    }
  }

  // 2. P99 Job Latency (Lag / Wait time)
  if (metrics.p99LatencyMs > thresholds.maxP99LatencyMs) {
    reasons.push(
      `P99 latency ${metrics.p99LatencyMs}ms exceeds maximum threshold ${thresholds.maxP99LatencyMs}ms.`,
    );
    recommendedEngine = targetEngine;
  }

  // 3. Workflow Duration
  if (
    metrics.workflowDurationSeconds !== undefined &&
    metrics.workflowDurationSeconds > thresholds.maxWorkflowDurationSeconds
  ) {
    reasons.push(
      `Workflow duration ${metrics.workflowDurationSeconds}s exceeds maximum threshold ${thresholds.maxWorkflowDurationSeconds}s.`,
    );
    recommendedEngine = "Temporal";
  }

  // 4. Multi-step Saga Complexity
  if (
    thresholds.maxWorkflowSteps !== undefined &&
    metrics.workflowSteps !== undefined &&
    metrics.workflowSteps > thresholds.maxWorkflowSteps
  ) {
    reasons.push(
      `Workflow steps ${metrics.workflowSteps} exceeds orchestration threshold ${thresholds.maxWorkflowSteps} steps.`,
    );
    recommendedEngine = "Temporal";
  }

  // 5. Global Database Saturation
  if (
    metrics.databaseCpuPercent !== undefined &&
    metrics.databaseCpuPercent > config.global.maxDatabaseCpuPercent
  ) {
    reasons.push(
      `Database CPU saturation ${metrics.databaseCpuPercent}% exceeds threshold ${config.global.maxDatabaseCpuPercent}%.`,
    );
    recommendedEngine = targetEngine;
  }

  if (
    metrics.databaseIopsPercent !== undefined &&
    metrics.databaseIopsPercent > config.global.maxDatabaseIopsPercent
  ) {
    reasons.push(
      `Database IOPS saturation ${metrics.databaseIopsPercent}% exceeds threshold ${config.global.maxDatabaseIopsPercent}%.`,
    );
    recommendedEngine = targetEngine;
  }

  return {
    exceeded: reasons.length > 0,
    reasons,
    recommendedEngine,
    currentEngine: "pg-boss",
  };
}
