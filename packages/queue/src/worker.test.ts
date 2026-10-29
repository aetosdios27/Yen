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
  let releaseConcurrency: (() => void) | undefined;
  let concurrencyGate = Promise.resolve();
  let resolveConcurrencyReached: (() => void) | undefined;
  let concurrencyReached = Promise.resolve();
  let resolveConcurrencyCompleted: (() => void) | undefined;
  let concurrencyCompleted = Promise.resolve();
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
      if (concurrency.active >= 2) resolveConcurrencyReached?.();
      await concurrencyGate;
      concurrency.active--;
      concurrency.completed++;
      if (concurrency.completed === 6) resolveConcurrencyCompleted?.();
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
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)}`;
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

    concurrency.active = 0;
    concurrency.max = 0;
    concurrency.completed = 0;
    concurrencyGate = new Promise<void>((resolve) => {
      releaseConcurrency = resolve;
    });
    concurrencyReached = new Promise<void>((resolve) => {
      resolveConcurrencyReached = resolve;
    });
    concurrencyCompleted = new Promise<void>((resolve) => {
      resolveConcurrencyCompleted = resolve;
    });

    for (let i = 0; i < 6; i++) {
      await boss.send("concurrency-work", { index: i });
    }

    try {
      await concurrencyReached;
      expect(concurrency.active).toBe(2);
      expect(concurrency.max).toBe(2);
    } finally {
      releaseConcurrency?.();
      releaseConcurrency = undefined;
      resolveConcurrencyReached = undefined;
    }
    await concurrencyCompleted;
    expect(concurrency.completed).toBe(6);
    expect(concurrency.max).toBe(2);
    resolveConcurrencyCompleted = undefined;
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

  it("isolates failures per job in a batch, ensuring subsequent jobs execute and complete while failing jobs retry and dead-letter", async () => {
    const BATCH_DLQ = "batch-dlq";
    const batchWorker = new WorkerRuntime({
      connectionString: targetUrl.toString(),
      schema: "pgboss",
      migrate: false,
      gracefulShutdownTimeoutMs: 5000,
      queues: {
        "batch-isolation-work": {
          localConcurrency: 1,
          batchSize: 5,
          retryLimit: 1,
          retryDelay: 0,
          retryBackoff: false,
          expireInSeconds: 10,
          deadLetter: BATCH_DLQ,
        },
      },
    });

    const executionCounts = new Map<string, number>();

    batchWorker.registerHandler("batch-isolation-work", async (job) => {
      const data = job.data as { id: string; shouldFail: boolean };
      executionCounts.set(data.id, (executionCounts.get(data.id) ?? 0) + 1);
      if (data.shouldFail) {
        throw new Error(`Deliberate failure for ${data.id}`);
      }
    });

    const boss = worker.getBoss();
    await boss.createQueue(BATCH_DLQ);
    await boss.createQueue("batch-isolation-work", {
      retryLimit: 1,
      retryDelay: 0,
      retryBackoff: false,
      expireInSeconds: 10,
      deadLetter: BATCH_DLQ,
    });
    const failJobId = await boss.send("batch-isolation-work", {
      id: "failing-job",
      shouldFail: true,
    });
    const successJob1Id = await boss.send("batch-isolation-work", {
      id: "success-job-1",
      shouldFail: false,
    });
    const successJob2Id = await boss.send("batch-isolation-work", {
      id: "success-job-2",
      shouldFail: false,
    });
    expect(failJobId).not.toBeNull();
    expect(successJob1Id).not.toBeNull();
    expect(successJob2Id).not.toBeNull();
    if (!failJobId || !successJob1Id || !successJob2Id) {
      throw new Error("Job IDs must not be null");
    }

    try {
      await batchWorker.start();

      // Wait until the failing job exhausts retries and lands in the dead-letter queue
      const deadLetterRow = await waitFor(async () => {
        const rows = await sql<{ name: string; data: unknown }[]>`
          SELECT name, data FROM pgboss.job
          WHERE name = ${BATCH_DLQ} AND data->>'id' = 'failing-job'
        `;
        return rows[0];
      });

      expect(deadLetterRow).toBeDefined();

      // Wait until success jobs reach their final state
      await waitFor(async () => {
        const rows = await sql<{ id: string; state: string }[]>`
          SELECT id, state FROM pgboss.job
          WHERE id IN (${failJobId}, ${successJob1Id}, ${successJob2Id})
        `;
        const states = new Map(rows.map((r) => [r.id, r.state]));
        if (
          states.get(failJobId) === "failed" &&
          states.get(successJob1Id) === "completed" &&
          states.get(successJob2Id) === "completed"
        ) {
          return true;
        }
        return undefined;
      });

      // Verify execution counts:
      // failing-job attempted twice (initial attempt + 1 retry)
      expect(executionCounts.get("failing-job")).toBe(2);
      // success jobs behind failing-job in the batch must have executed exactly once
      expect(executionCounts.get("success-job-1")).toBe(1);
      expect(executionCounts.get("success-job-2")).toBe(1);

      // Verify success jobs never landed in dead-letter
      const deadLetterSuccessRows = await sql<{ id: string }[]>`
        SELECT id FROM pgboss.job
        WHERE name = ${BATCH_DLQ} AND data->>'id' IN ('success-job-1', 'success-job-2')
      `;
      expect(deadLetterSuccessRows).toHaveLength(0);
    } finally {
      await batchWorker.stop();
    }
  });
});
