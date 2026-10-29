import { evaluateBudget, WRITE_BUDGET } from "../budgets.js";
import { runAutocannon } from "../client.js";
import type { StateVerificationResult, StateVerifier } from "../state-verifier.js";
import { DEFAULT_FUND_ID, type ScenarioExecutionResult } from "./read-scenario.js";

export interface WriteScenarioOptions {
  baseUrl: string;
  fundId?: string;
  duration?: number;
  connections?: number | undefined;
  amount?: number | undefined;
  stateVerifier?: StateVerifier | undefined;
}

export interface WriteScenarioExecutionResult extends ScenarioExecutionResult {
  stateVerification?: StateVerificationResult | undefined;
  idempotencyVerification?:
    | {
        passed: boolean;
        replayedRequests: number;
        newRowsCreated: number;
      }
    | undefined;
}

/**
 * Scenario 2 (Write-heavy):
 * Exercises money write paths:
 * - POST /v1/funds/{fundId}/donations/pledge
 * - Each request sends a distinct, unique Idempotency-Key
 * - Each request sends a distinct, valid 12-digit UPI UTR
 * - Valid integer amount in paise (e.g. 50000 paise = ₹500)
 *
 * Performance budget:
 * - p95 < 120ms, p99 < 300ms
 * - Error rate: 0.00%
 *
 * State side-effects:
 * - Database rows created must match the request count.
 */
export async function runWriteScenario(
  options: WriteScenarioOptions,
): Promise<WriteScenarioExecutionResult> {
  const fundId = options.fundId ?? DEFAULT_FUND_ID;
  const targetPath = `/v1/funds/${fundId}/donations/pledge`;
  const connections = options.connections ?? 10;

  const stateVerifier = options.stateVerifier;
  let countBefore = 0;
  if (stateVerifier) {
    countBefore = await stateVerifier.getPledgeCount(fundId);
  }

  // Generate unique 12-digit UTRs per request using a 6-digit run timestamp + 6-digit sequence
  const runTimestamp = (Date.now() % 1000000).toString().padStart(6, "0");
  let sequence = 0;

  const prepareRequest = (client: {
    setHeaders: (headers: Record<string, string>) => void;
    setBody: (body: string) => void;
  }) => {
    sequence++;
    const utr = `${runTimestamp}${sequence.toString().padStart(6, "0")}`;
    const idempotencyKey = crypto.randomUUID();

    client.setHeaders({
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    });
    client.setBody(
      JSON.stringify({
        amountPaise: "50000",
        utr,
        donorName: `LoadTest Donor ${sequence}`,
      }),
    );
  };

  const autocannonOpts: Parameters<typeof runAutocannon>[0] = {
    scenarioName: "Write-heavy (Donation Pledges)",
    url: `${options.baseUrl}${targetPath}`,
    method: "POST",
    connections,
    setupClient: (client) => {
      prepareRequest(client);
      client.on("response", () => {
        prepareRequest(client);
      });
    },
  };

  if (options.amount !== undefined) {
    // Exact count mode
    (autocannonOpts as unknown as { amount: number }).amount = options.amount;
  } else {
    autocannonOpts.duration = options.duration ?? 5;
  }

  const { metrics, raw } = await runAutocannon(autocannonOpts);

  const budgetCheck = evaluateBudget(metrics, WRITE_BUDGET);

  let stateVerification: StateVerificationResult | undefined;
  let idempotencyVerification:
    | { passed: boolean; replayedRequests: number; newRowsCreated: number }
    | undefined;

  if (stateVerifier) {
    // Allow server event loop to drain in-flight packets before verifying counts
    await new Promise((r) => setTimeout(r, 100));
    const countAfter = await stateVerifier.getPledgeCount(fundId);
    const createdRows = countAfter - countBefore;
    const successfulResponses = raw["2xx"];

    // In duration mode, in-flight requests at test termination may complete on the server
    // within the concurrency limit (connections). In amount mode, it is an exact match.
    const discrepancy = Math.abs(createdRows - successfulResponses);
    const maxAllowedInFlight = options.amount !== undefined ? 0 : connections;
    const passed = discrepancy <= maxAllowedInFlight && createdRows > 0;

    stateVerification = {
      passed,
      beforeCount: countBefore,
      afterCount: countAfter,
      createdRows,
      expectedRows: successfulResponses,
      discrepancy: createdRows - successfulResponses,
      error: passed
        ? undefined
        : `Database row count discrepancy (${discrepancy}) exceeded allowed in-flight concurrency (${maxAllowedInFlight})`,
    };

    // Run a controlled idempotency replay check to verify that retrying requests does NOT create new rows
    const testUtr = `99${(Date.now() % 10000000000).toString().padStart(10, "0")}`;
    const testIdempotencyKey = crypto.randomUUID();
    const pledgePayload = JSON.stringify({
      amountPaise: "25000",
      utr: testUtr,
      donorName: "Idempotency Test Donor",
    });

    // Initial POST
    const res1 = await fetch(`${options.baseUrl}${targetPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": testIdempotencyKey,
      },
      body: pledgePayload,
    });
    const probeAfterFirst = await stateVerifier.getPledgeCount(fundId);

    // Replay exact same request
    const res2 = await fetch(`${options.baseUrl}${targetPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": testIdempotencyKey,
      },
      body: pledgePayload,
    });
    const probeAfterSecond = await stateVerifier.getPledgeCount(fundId);

    const firstSuccess = res1.status === 201;
    let secondReplayed = res2.status === 201;
    try {
      const b1 = (await res1.json()) as { donationId?: string };
      const b2 = (await res2.json()) as { donationId?: string };
      secondReplayed =
        res2.status === 201 &&
        (res2.headers.get("idempotent-replayed") === "true" || b1.donationId === b2.donationId);
    } catch {
      secondReplayed = res2.status === 201;
    }
    const noExtraRows = probeAfterSecond === probeAfterFirst;

    idempotencyVerification = {
      passed: firstSuccess && secondReplayed && noExtraRows,
      replayedRequests: 1,
      newRowsCreated: probeAfterSecond - probeAfterFirst,
    };
  }

  return { metrics, budgetCheck, stateVerification, idempotencyVerification };
}
