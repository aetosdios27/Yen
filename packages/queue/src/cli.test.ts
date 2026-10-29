import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSql } from "@yen/db";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observePgBossErrors } from "./boss.js";
import { describePostgres, waitFor } from "./test-utils.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

interface WorkerProcess {
  child: ChildProcess;
  output: string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Starts a worker in its own process group so SIGTERM reaches pnpm and the node child alike. */
function spawnWorker(file: string, args: string[], env: NodeJS.ProcessEnv): WorkerProcess {
  const child = spawn(file, args, {
    cwd: packageDir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const proc: WorkerProcess = {
    child,
    output: "",
    exit: new Promise((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    ),
  };
  const collect = (chunk: Buffer) => {
    proc.output += chunk.toString("utf8");
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return proc;
}

async function waitForOutput(proc: WorkerProcess, text: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.output.includes(text)) return;
    if (proc.child.exitCode !== null || proc.child.signalCode !== null) {
      throw new Error(
        `Worker exited with code=${proc.child.exitCode} signal=${proc.child.signalCode} before printing "${text}": ${proc.output}`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for "${text}". Output so far: ${proc.output}`);
}

function sigterm(proc: WorkerProcess): void {
  const pid = proc.child.pid;
  if (pid === undefined) throw new Error("Worker process has no pid");
  process.kill(-pid, "SIGTERM");
}

/** Environment for the documented startup command. QUEUE_SCHEMA is left at its default. */
function workerEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    QUEUE_MIGRATE: "true",
  };
  delete env.QUEUE_SCHEMA;
  return env;
}

describe("queue CLI startup validation", () => {
  it("fails fast with exit code 1 and names DATABASE_URL when it is not set", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    const proc = spawnWorker(
      process.execPath,
      [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
      env,
    );

    expect(await proc.exit).toEqual({ code: 1, signal: null });
    expect(proc.output).toContain("DATABASE_URL is required");
    expect(proc.output).not.toContain("started and listening");
  });

  it("refuses an injected QUEUE_SCHEMA before connecting to Postgres", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: "postgres://worker:pw@127.0.0.1:1/yen",
      QUEUE_SCHEMA: "pgboss; DROP SCHEMA public",
    };
    const proc = spawnWorker(
      process.execPath,
      [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
      env,
    );

    expect(await proc.exit).toEqual({ code: 1, signal: null });
    expect(proc.output).toContain("QUEUE_SCHEMA must be");
    expect(proc.output).not.toContain("Worker failed to start");
  });
});

describePostgres("queue CLI runtime", (adminUrl) => {
  const testDbName = `yen_queue_cli_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());
  const running: WorkerProcess[] = [];

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;
  });

  afterAll(async () => {
    for (const proc of running) {
      if (proc.child.exitCode === null && proc.child.signalCode === null) sigterm(proc);
      await proc.exit;
    }
    try {
      await sql.end({ timeout: 5 });
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)}`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  function startDocumentedWorker(): WorkerProcess {
    const proc = spawnWorker("pnpm", ["start"], workerEnv(targetUrl.toString()));
    running.push(proc);
    return proc;
  }

  it("starts with the documented pnpm start command and exits 0 on SIGTERM", async () => {
    const proc = startDocumentedWorker();

    await waitForOutput(proc, "Worker runtime started");
    sigterm(proc);

    const exit = await proc.exit;
    expect(proc.output).toContain("Worker runtime stopped.");
    expect(
      (exit.code === 0 && exit.signal === null) ||
        (exit.code === null && exit.signal === "SIGTERM"),
    ).toBe(true);
  }, 30000);

  it("finishes a graceful stop when SIGTERM arrives twice", async () => {
    // Process managers and wrappers such as `pnpm start` can deliver SIGTERM to both the wrapper and
    // the worker. A second signal during shutdown must not fall back to the default kill.
    const proc = spawnWorker(
      process.execPath,
      [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
      workerEnv(targetUrl.toString()),
    );
    running.push(proc);
    await waitForOutput(proc, "Worker runtime started");

    const pid = proc.child.pid;
    if (pid === undefined) throw new Error("Worker process has no pid");
    // Exactly two signals, a few milliseconds apart: the second lands while the first is stopping.
    process.kill(pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The worker already exited cleanly; nothing left to signal.
    }

    expect(await proc.exit).toEqual({ code: 0, signal: null });
    expect(proc.output).toContain("Worker runtime stopped.");
  }, 30000);

  it("does not complete a job on a queue with no implemented handler", async () => {
    const proc = startDocumentedWorker();
    await waitForOutput(proc, "Worker runtime started");

    const boss = observePgBossErrors(
      new PgBoss({
        connectionString: targetUrl.toString(),
        schema: "pgboss",
        migrate: false,
        supervise: false,
        schedule: false,
      }),
    );
    await boss.start();
    let jobId: string | null;
    try {
      jobId = await boss.send("notifications", { fundId: "fund-1", eventId: "event-1" });
    } finally {
      await boss.stop();
    }
    expect(jobId).not.toBeNull();

    // The handler throws, so pg-boss records the failure and parks the job in retry.
    const job = await waitFor(async () => {
      const [row] = await sql<{ state: string; output: { message?: string } | null }[]>`
        SELECT state, output FROM pgboss.job WHERE id = ${jobId}
      `;
      return row !== undefined && row.state !== "created" && row.state !== "active"
        ? row
        : undefined;
    }, 15000);

    expect(job.state).toBe("retry");
    expect(job.output?.message).toContain(
      "No job handler is implemented for queue 'notifications'",
    );

    sigterm(proc);
    const exit = await proc.exit;
    expect(proc.output).toContain("Worker runtime stopped.");
    expect(
      (exit.code === 0 && exit.signal === null) ||
        (exit.code === null && exit.signal === "SIGTERM"),
    ).toBe(true);
  }, 30000);
});
