#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createSql } from "@yen/db";
import type { BudgetCheckResult, ScenarioMetrics } from "./budgets.js";
import { type RunningHarnessServer, startHarnessServer } from "./harness-server.js";
import { runAuthScenario, runReadScenario, runWriteScenario } from "./scenarios/index.js";
import {
  MemoryStateVerifier,
  PostgresStateVerifier,
  type StateVerificationResult,
  type StateVerifier,
} from "./state-verifier.js";

interface CliOptions {
  target?: string | undefined;
  duration: number;
  connections: number;
  amount?: number | undefined;
  scenario: "all" | "read" | "write" | "auth";
  verifyState: boolean;
  databaseUrl?: string | undefined;
  budgetFail: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      target: { type: "string", short: "t" },
      duration: { type: "string", short: "d", default: "5" },
      connections: { type: "string", short: "c", default: "10" },
      amount: { type: "string", short: "a" },
      scenario: { type: "string", short: "s", default: "all" },
      "verify-state": { type: "boolean", default: true },
      "database-url": { type: "string" },
      "budget-fail": { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`
Yen Load-Test Harness & Performance Budget Runner

Usage:
  pnpm test:load [options]

Options:
  -t, --target <url>       Target server URL (defaults to auto-booted local test harness)
  -d, --duration <sec>     Duration of each load scenario in seconds (default: 5)
  -c, --connections <n>    Number of concurrent connections (default: 10)
  -a, --amount <n>         Exact number of requests to send instead of duration
  -s, --scenario <name>    Scenario to run: all | read | write | auth (default: all)
  --verify-state           Verify database state side-effects match HTTP 200 counts (default: true)
  --database-url <url>     PostgreSQL database URL for state verification
  --no-budget-fail         Do not exit with code 1 when performance budgets are breached
  -h, --help               Show this help message
`);
    process.exit(0);
  }

  const duration = Math.max(1, Number.parseInt(String(values.duration ?? "5"), 10) || 5);
  const connections = Math.max(1, Number.parseInt(String(values.connections ?? "10"), 10) || 10);
  const amount = values.amount ? Number.parseInt(String(values.amount), 10) : undefined;
  const scenario = String(values.scenario ?? "all").toLowerCase() as CliOptions["scenario"];

  const databaseUrl =
    (values["database-url"] as string | undefined) ??
    process.env.YEN_TEST_DATABASE_URL ??
    process.env.DATABASE_URL;

  return {
    target: values.target as string | undefined,
    duration,
    connections,
    amount,
    scenario: ["all", "read", "write", "auth"].includes(scenario) ? scenario : "all",
    verifyState: values["verify-state"] !== false,
    databaseUrl,
    budgetFail: values["budget-fail"] !== false,
  };
}

function printScenarioResult(
  metrics: ScenarioMetrics,
  budgetCheck: BudgetCheckResult,
  stateResult?: StateVerificationResult,
  idempotencyResult?: { passed: boolean; replayedRequests: number; newRowsCreated: number },
) {
  console.log(`\n================================================================`);
  console.log(`Scenario: ${metrics.scenario}`);
  console.log(`================================================================`);
  console.log(
    `Throughput:  ${metrics.requestsTotal} requests (${metrics.requestsPerSecond.toFixed(1)} req/s)`,
  );
  console.log(
    `Latency:     p50: ${metrics.p50LatencyMs.toFixed(1)}ms | p90: ${metrics.p90LatencyMs.toFixed(1)}ms | p95: ${metrics.p95LatencyMs.toFixed(1)}ms | p99: ${metrics.p99LatencyMs.toFixed(1)}ms | max: ${metrics.maxLatencyMs.toFixed(1)}ms`,
  );
  console.log(
    `Errors:      ${metrics.errorCount} socket errors, ${metrics.non2xxCount} non-2xx responses (Rate: ${metrics.errorRate.toFixed(2)}%)`,
  );
  console.log(`----------------------------------------------------------------`);
  console.log(`Performance Budgets:`);

  for (const check of budgetCheck.checks) {
    const symbol = check.passed ? "✔ PASS" : "✖ FAIL";
    console.log(
      `  ${symbol}  ${check.metric.padEnd(16)}: ${check.actual.toFixed(2)}${check.unit} (budget: <= ${check.budget}${check.unit})`,
    );
  }

  if (stateResult) {
    console.log(`----------------------------------------------------------------`);
    console.log(`State Side-Effects Verification:`);
    const symbol = stateResult.passed ? "✔ PASS" : "✖ FAIL";
    console.log(
      `  ${symbol}  Database row count: created ${stateResult.createdRows} rows, expected ${stateResult.expectedRows} rows`,
    );
    if (!stateResult.passed) {
      console.log(
        `         Discrepancy: ${stateResult.discrepancy} rows (${stateResult.error ?? "mismatch"})`,
      );
    }
  }

  if (idempotencyResult) {
    const symbol = idempotencyResult.passed ? "✔ PASS" : "✖ FAIL";
    console.log(
      `  ${symbol}  Idempotency replay safety: 0 duplicate rows created across replayed requests`,
    );
  }
}

export async function main() {
  const options = parseCliArgs();
  console.log(`Starting Yen Load-Test Runner...`);
  console.log(
    `Configuration: duration=${options.duration}s, connections=${options.connections}, scenario=${options.scenario}`,
  );

  let server: RunningHarnessServer | undefined;
  let stateVerifier: StateVerifier;
  let sql: ReturnType<typeof createSql> | undefined;

  if (options.databaseUrl) {
    console.log(`Connecting to database for state verification...`);
    sql = createSql(options.databaseUrl);
    stateVerifier = new PostgresStateVerifier(sql);
    await stateVerifier.ensureSchema();
  } else {
    stateVerifier = new MemoryStateVerifier();
  }

  let baseUrl = options.target;
  if (!baseUrl) {
    console.log(`Target URL not specified. Starting isolated in-process test harness server...`);
    server = await startHarnessServer({ ...(sql ? { sql } : {}), stateVerifier });
    baseUrl = server.url;
    console.log(`Harness server listening at ${baseUrl}`);
  } else {
    console.log(`Targeting running server at ${baseUrl}`);
  }

  const results: { name: string; passed: boolean }[] = [];

  try {
    // Scenario 1: Read-heavy
    if (options.scenario === "all" || options.scenario === "read") {
      const { metrics, budgetCheck } = await runReadScenario({
        baseUrl,
        duration: options.duration,
        connections: options.connections,
      });
      printScenarioResult(metrics, budgetCheck);
      results.push({ name: metrics.scenario, passed: budgetCheck.passed });
    }

    // Scenario 2: Write-heavy (with state side-effects)
    if (options.scenario === "all" || options.scenario === "write") {
      const { metrics, budgetCheck, stateVerification, idempotencyVerification } =
        await runWriteScenario({
          baseUrl,
          duration: options.duration,
          connections: options.connections,
          amount: options.amount,
          stateVerifier: options.verifyState ? stateVerifier : undefined,
        });
      printScenarioResult(metrics, budgetCheck, stateVerification, idempotencyVerification);
      const passed =
        budgetCheck.passed &&
        (stateVerification ? stateVerification.passed : true) &&
        (idempotencyVerification ? idempotencyVerification.passed : true);
      results.push({ name: metrics.scenario, passed });
    }

    // Scenario 3: Auth/Session
    if (options.scenario === "all" || options.scenario === "auth") {
      const { metrics, budgetCheck } = await runAuthScenario({
        baseUrl,
        duration: options.duration,
        connections: options.connections,
      });
      printScenarioResult(metrics, budgetCheck);
      results.push({ name: metrics.scenario, passed: budgetCheck.passed });
    }

    console.log(`\n================================================================`);
    console.log(`LOAD TEST SUMMARY`);
    console.log(`================================================================`);
    let allPassed = true;
    for (const r of results) {
      const status = r.passed ? "✔ PASSED" : "✖ FAILED";
      console.log(`  ${status.padEnd(10)} ${r.name}`);
      if (!r.passed) allPassed = false;
    }

    if (allPassed) {
      console.log(`\n🎉 All performance budgets and state side-effects PASSED!`);
      process.exitCode = 0;
    } else {
      console.error(`\n❌ Performance budgets or state verification FAILED.`);
      if (options.budgetFail) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`Fatal error running load tests:`, error);
    process.exitCode = 1;
  } finally {
    if (server) {
      await server.close();
    }
    if (sql) {
      await sql.end({ timeout: 2 });
    }
  }
}

if (process.argv[1] && (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"))) {
  main();
}
