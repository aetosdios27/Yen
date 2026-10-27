import { randomUUID } from "node:crypto";
import { createSql } from "@yen/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describePostgres } from "./test-utils.js";
import { WorkerRuntime } from "./worker.js";

interface ErrorDetails {
  message?: string;
}

describePostgres("WorkerRuntime", (adminUrl) => {
  const testDbName = `yen_queue_worker_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());

  const dlqName = "failed-dlq";
  let worker: WorkerRuntime;
  const processed: string[] = [];

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;

    worker = new WorkerRuntime({
      connectionString: targetUrl.toString(),
      schema: "pgboss",
      migrate: true,
      gracefulShutdownTimeoutMs: 5000,
      queues: {
        "simple-work": {
          teamConcurrency: 2,
          batchSize: 1,
          retryLimit: 1,
          expireInSeconds: 30,
        },
        "flaky-work": {
          teamConcurrency: 1,
          batchSize: 1,
          retryLimit: 0,
          retryDelay: 0,
          expireInSeconds: 10,
          deadLetter: dlqName,
        },
      },
    });

    worker.registerHandler("simple-work", async (job) => {
      processed.push((job.data as { value: string }).value);
    });

    worker.registerHandler("flaky-work", async () => {
      throw new Error("Permanent processing error");
    });

    await worker.start();
  });

  afterAll(async () => {
    try {
      await worker.stop();
      await sql.end({ timeout: 5 });
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)} WITH (FORCE)`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it("processes enqueued jobs to completion", async () => {
    const boss = worker.getBoss();

    await boss.send("simple-work", { value: "job-1" });
    await boss.send("simple-work", { value: "job-2" });

    const start = Date.now();
    while (processed.length < 2 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(processed).toEqual(["job-1", "job-2"]);
  });

  it("routes failing jobs exceeding retry limit to dead-letter queue", async () => {
    const boss = worker.getBoss();

    await boss.send(
      "flaky-work",
      { testId: "failed-attempt-1" },
      { retryLimit: 0, deadLetter: dlqName },
    );

    let dlqJobs = await worker.getDeadLetterJobs("flaky-work");
    const start = Date.now();
    while (dlqJobs.length === 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
      dlqJobs = await worker.getDeadLetterJobs("flaky-work");
    }

    expect(dlqJobs.length).toBeGreaterThan(0);
    expect(dlqJobs[0]?.name).toBe("flaky-work");
    expect(dlqJobs[0]?.state).toBe("failed");
    expect((dlqJobs[0]?.output as ErrorDetails | undefined)?.message).toBe(
      "Permanent processing error",
    );

    const dlqRows = await sql`SELECT id, name, state FROM pgboss.job WHERE name = ${dlqName}`;
    expect(dlqRows.length).toBeGreaterThan(0);
  });
});
