import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSql } from "@yen/db";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, it } from "vitest";
import { observePgBossErrors } from "./boss.js";
import { describePostgres, waitFor } from "./test-utils.js";
import { WorkerRuntime } from "./worker.js";

describePostgres("Worker Process Crash and Exact-Once Retry", (adminUrl) => {
  const testDbName = `yen_queue_crash_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;
    // Setup schema
    const boss = observePgBossErrors(
      new PgBoss({
        connectionString: targetUrl.toString(),
        schema: "pgboss",
        migrate: true,
        supervise: false,
      }),
    );
    await boss.start();
    await boss.createQueue("crash-resilient-queue", {
      retryLimit: 1,
      retryDelay: 0,
      expireInSeconds: 2,
    });
    await boss.stop();
  });

  afterAll(async () => {
    try {
      await sql.end({ timeout: 5 });
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)}`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it("retries an interrupted job exactly once to completion after killing the worker process mid-run", async () => {
    const boss = observePgBossErrors(
      new PgBoss({
        connectionString: targetUrl.toString(),
        schema: "pgboss",
        migrate: false,
      }),
    );
    let recoveryWorker: WorkerRuntime | null = null;

    try {
      await boss.start();

      const jobId = await boss.send("crash-resilient-queue", {
        transactionId: "tx-789",
        amount: 25000,
      });
      expect(jobId).toBeDefined();

      // 2. Spawn child worker process
      const childWorkerScript = fileURLToPath(
        new URL("../dist/test-child-worker.js", import.meta.url),
      );

      const child = spawn(process.execPath, [childWorkerScript], {
        env: {
          ...process.env,
          DATABASE_URL: targetUrl.toString(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let jobStarted = false;

      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          if (text.includes("JOB_STARTED")) {
            jobStarted = true;
            resolve();
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          process.stderr.write(`[child stderr] ${chunk.toString("utf8")}`);
        });
        child.on("error", reject);
      });

      expect(jobStarted).toBe(true);

      // Verify in DB that job was claimed and is active on attempt 0
      const [claimedRow] = await sql`
          SELECT id, state, retry_count FROM pgboss.job WHERE id = ${jobId}::uuid
        `;
      expect(claimedRow?.state).toBe("active");
      expect(claimedRow?.retry_count).toBe(0);

      // 3. Kill the child worker process mid-run with SIGKILL
      child.kill("SIGKILL");

      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      // 4. Wait for the 2-second expireInSeconds window to lapse
      await new Promise((r) => setTimeout(r, 2500));

      // 5. Trigger supervisor reclaim on the abandoned active job
      await boss.supervise("crash-resilient-queue");

      // Verify the supervisor reclaimed the expired active job and put it in retry
      const [reclaimedRow] = await sql`
          SELECT id, state, retry_count FROM pgboss.job WHERE id = ${jobId}::uuid
        `;
      expect(reclaimedRow?.state).toBe("retry");
      expect(reclaimedRow?.retry_count).toBe(0);

      // 6. Start recovery worker to process the retry attempt to completion
      recoveryWorker = new WorkerRuntime({
        connectionString: targetUrl.toString(),
        schema: "pgboss",
        migrate: false,
        queues: {
          "crash-resilient-queue": {
            localConcurrency: 1,
            batchSize: 1,
            retryLimit: 1,
            expireInSeconds: 10,
          },
        },
      });

      let retriedAttemptCount: number | null = null;
      let recoveryCompleted = false;

      recoveryWorker.registerHandler("crash-resilient-queue", async (job) => {
        retriedAttemptCount = job.retryCount;
        recoveryCompleted = true;
      });

      await recoveryWorker.start();

      const start = Date.now();
      while (!recoveryCompleted && Date.now() - start < 6000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(recoveryCompleted).toBe(true);
      expect(retriedAttemptCount).toBe(1); // Retried on attempt 1 (exactly once)

      // 7. Verify final database state: completed with retry_count = 1. The handler sets its flag
      // before it returns, and pg-boss records completion only after that, so poll for the state
      // instead of reading it once (a single read raced with the completion write on slow runners).
      const finalRow = await waitFor(async () => {
        const [row] = await sql`
          SELECT id, state, retry_count FROM pgboss.job WHERE id = ${jobId}::uuid
        `;
        return row?.state === "completed" ? row : undefined;
      }, 10000);
      expect(finalRow.state).toBe("completed");
      expect(finalRow.retry_count).toBe(1);
    } finally {
      if (recoveryWorker) {
        await recoveryWorker.stop();
      }
      await boss.stop();
    }
  }, 15000);
});
