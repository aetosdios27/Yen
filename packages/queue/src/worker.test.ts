import { randomUUID } from "node:crypto";
import { createSql } from "@yen/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describePostgres, waitFor } from "./test-utils.js";
import { WorkerRuntime } from "./worker.js";

const DLQ_NAME = "failed-dlq";

describePostgres("WorkerRuntime", (adminUrl) => {
  const testDbName = `yen_queue_worker_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());
  let worker: WorkerRuntime;

  const processed: string[] = [];
  const concurrency = { active: 0, max: 0, completed: 0 };
  const attemptsById = new Map<string, number>();

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;

    worker = new WorkerRuntime({
      connectionString: targetUrl.toString(),
      schema: "pgboss",
      migrate: true,
      gracefulShutdownTimeoutMs: 5000,
      queues: {
        "simple-work": {
          localConcurrency: 2,
          batchSize: 1,
          retryLimit: 1,
          expireInSeconds: 30,
        },
        "concurrency-work": {
          localConcurrency: 2,
          batchSize: 1,
          retryLimit: 0,
          expireInSeconds: 30,
        },
        "retry-policy-work": {
          localConcurrency: 1,
          batchSize: 1,
          retryLimit: 1,
          retryDelay: 0,
          retryBackoff: false,
          expireInSeconds: 10,
        },
        "dlq-policy-work": {
          localConcurrency: 1,
          batchSize: 1,
          retryLimit: 0,
          retryDelay: 0,
          expireInSeconds: 10,
          deadLetter: DLQ_NAME,
        },
      },
    });

    worker.registerHandler("simple-work", async (job) => {
      processed.push((job.data as { value: string }).value);
    });

    worker.registerHandler("concurrency-work", async () => {
      concurrency.active++;
      concurrency.max = Math.max(concurrency.max, concurrency.active);
      await new Promise((r) => setTimeout(r, 100));
      concurrency.active--;
      concurrency.completed++;
    });

    worker.registerHandler("retry-policy-work", async (job) => {
      const testId = (job.data as { testId: string }).testId;
      attemptsById.set(testId, (attemptsById.get(testId) ?? 0) + 1);
      throw new Error("Deliberate failure for the retry policy test");
    });

    worker.registerHandler("dlq-policy-work", async () => {
      throw new Error("Permanent processing error for the dead-letter test");
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

    await waitFor(async () => (processed.length >= 2 ? true : undefined));

    expect(processed.sort()).toEqual(["job-1", "job-2"]);
  });

  it("never runs more handlers at once than localConcurrency, and reaches that limit", async () => {
    const boss = worker.getBoss();

    for (let i = 0; i < 6; i++) {
      await boss.send("concurrency-work", { index: i });
    }

    await waitFor(async () => (concurrency.completed >= 6 ? true : undefined));

    expect(concurrency.completed).toBe(6);
    expect(concurrency.max).toBe(2);
  });

  it("calls a handler that always throws retryLimit + 1 times, then marks the job failed", async () => {
    const boss = worker.getBoss();
    const testId = "retry-policy-check";
    const jobId = await boss.send("retry-policy-work", { testId });
    expect(jobId).not.toBeNull();

    await waitFor(async () => {
      const [row] = await sql<{ state: string }[]>`
        SELECT state FROM pgboss.job WHERE id = ${jobId}
      `;
      return row?.state === "failed" ? true : undefined;
    });

    // retryLimit is 1, so the first attempt plus one retry: two calls in total.
    expect(attemptsById.get(testId)).toBe(2);
    const [row] = await sql<{ retry_count: number }[]>`
      SELECT retry_count FROM pgboss.job WHERE id = ${jobId}
    `;
    expect(row?.retry_count).toBe(1);
  });

  it("moves a job whose retries are exhausted into the configured deadLetter queue", async () => {
    const boss = worker.getBoss();
    const payload = { testId: "dead-letter-check", amount: 500 };
    const jobId = await boss.send("dlq-policy-work", payload);
    expect(jobId).not.toBeNull();

    const deadLetterRow = await waitFor(async () => {
      const rows = await sql<{ name: string; data: unknown }[]>`
        SELECT name, data FROM pgboss.job
        WHERE name = ${DLQ_NAME} AND data->>'testId' = ${payload.testId}
      `;
      return rows[0];
    });

    expect(deadLetterRow.name).toBe(DLQ_NAME);
    expect(deadLetterRow.data).toEqual(payload);

    const [sourceRow] = await sql<{ state: string }[]>`
      SELECT state FROM pgboss.job WHERE id = ${jobId}
    `;
    expect(sourceRow?.state).toBe("failed");
  });

  it("stop() lets an in-flight job finish before resolving, and a second stop() is a no-op", async () => {
    const gracefulWorker = new WorkerRuntime({
      connectionString: targetUrl.toString(),
      schema: "pgboss",
      migrate: false,
      gracefulShutdownTimeoutMs: 5000,
      queues: {
        "graceful-work": {
          localConcurrency: 1,
          batchSize: 1,
          expireInSeconds: 30,
        },
      },
    });

    // The handler finishes only when the test releases it, so the job is in flight during stop().
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let jobStarted = false;
    let jobFinished = false;

    gracefulWorker.registerHandler("graceful-work", async () => {
      jobStarted = true;
      await gate;
      jobFinished = true;
    });

    try {
      await gracefulWorker.start();
      const jobId = await gracefulWorker.getBoss().send("graceful-work", { action: "graceful" });

      await waitFor(async () => (jobStarted ? true : undefined));

      const firstStop = gracefulWorker.stop();
      const secondStop = gracefulWorker.stop();
      let secondStopped = false;
      void secondStop.then(() => {
        secondStopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(jobFinished).toBe(false);
      expect(secondStopped).toBe(false);

      release();
      await firstStop;
      await secondStop;

      expect(jobFinished).toBe(true);
      const [row] = await sql<{ state: string }[]>`
        SELECT state FROM pgboss.job WHERE id = ${jobId}
      `;
      expect(row?.state).toBe("completed");

      await expect(gracefulWorker.stop()).resolves.toBeUndefined();
    } finally {
      release();
      await gracefulWorker.stop();
    }
  });
});
