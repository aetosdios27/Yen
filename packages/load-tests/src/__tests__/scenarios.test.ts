import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningHarnessServer, startHarnessServer } from "../harness-server.js";
import { runAuthScenario } from "../scenarios/auth-scenario.js";
import { runReadScenario } from "../scenarios/read-scenario.js";
import { runWriteScenario } from "../scenarios/write-scenario.js";

describe("Load Test Scenarios (Integration)", () => {
  let server: RunningHarnessServer;

  beforeAll(async () => {
    server = await startHarnessServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("executes Scenario 1 (Read-heavy) and verifies performance budget", async () => {
    const { metrics, budgetCheck } = await runReadScenario({
      baseUrl: server.url,
      duration: 1,
      connections: 2,
    });

    expect(metrics.requestsTotal).toBeGreaterThan(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.non2xxCount).toBe(0);
    expect(metrics.errorRate).toBe(0.0);
    expect(metrics.p95LatencyMs).toBeLessThanOrEqual(50);
    expect(metrics.p99LatencyMs).toBeLessThanOrEqual(150);
    expect(budgetCheck.passed).toBe(true);
  });

  it("executes Scenario 2 (Write-heavy) and verifies budget and state side-effects", async () => {
    const { metrics, budgetCheck, stateVerification, idempotencyVerification } =
      await runWriteScenario({
        baseUrl: server.url,
        duration: 1,
        connections: 2,
        stateVerifier: server.stateVerifier,
      });

    expect(metrics.requestsTotal).toBeGreaterThan(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.non2xxCount).toBe(0);
    expect(metrics.errorRate).toBe(0.0);
    expect(metrics.p95LatencyMs).toBeLessThanOrEqual(120);
    expect(metrics.p99LatencyMs).toBeLessThanOrEqual(300);
    expect(budgetCheck.passed).toBe(true);

    // State side-effects verification
    expect(stateVerification).toBeDefined();
    expect(stateVerification?.passed).toBe(true);
    expect(stateVerification?.createdRows).toBeGreaterThan(0);

    // Idempotency replay verification
    expect(idempotencyVerification).toBeDefined();
    expect(idempotencyVerification?.passed).toBe(true);
    expect(idempotencyVerification?.newRowsCreated).toBe(0);
  });

  it("executes Scenario 3 (Auth/Session) and verifies performance budget", async () => {
    const { metrics, budgetCheck } = await runAuthScenario({
      baseUrl: server.url,
      duration: 1,
      connections: 2,
    });

    expect(metrics.requestsTotal).toBeGreaterThan(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.non2xxCount).toBe(0);
    expect(metrics.errorRate).toBe(0.0);
    expect(metrics.p95LatencyMs).toBeLessThanOrEqual(50);
    expect(metrics.p99LatencyMs).toBeLessThanOrEqual(150);
    expect(budgetCheck.passed).toBe(true);
  });
});
