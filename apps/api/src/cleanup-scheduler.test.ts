import { migrate } from "@yen/db";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { type CleanupFailure, startCleanupScheduler } from "./cleanup-scheduler.js";
import { PostgresIdempotencyStore, PostgresRateLimitStore } from "./postgres-stores.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startCleanupScheduler", () => {
  it("runs every task once per interval with the clock value and batch limit", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 0);
    const scheduler = startCleanupScheduler([{ name: "sweep", run }], {
      intervalMs: 1000,
      batchLimit: 7,
      clock: () => 5000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(5000, 7);
    await scheduler.stop();
  });

  it("stop() prevents further ticks", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 0);
    const scheduler = startCleanupScheduler([{ name: "sweep", run }], {
      intervalMs: 1000,
      clock: () => 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a failing task without throwing and still runs the other tasks on later ticks", async () => {
    vi.useFakeTimers();
    const failures: CleanupFailure[] = [];
    const flaky = vi.fn(async (): Promise<number> => {
      throw new TypeError("connection string with secret detail");
    });
    const healthy = vi.fn(async () => 1);
    const scheduler = startCleanupScheduler(
      [
        { name: "flaky", run: flaky },
        { name: "healthy", run: healthy },
      ],
      { intervalMs: 1000, clock: () => 0, onFailure: (failure) => failures.push(failure) },
    );
    await vi.advanceTimersByTimeAsync(2000);
    await scheduler.stop();

    expect(flaky).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(failures).toEqual([
      { event: "cleanup_failed", task: "flaky", errorName: "TypeError" },
      { event: "cleanup_failed", task: "flaky", errorName: "TypeError" },
    ]);
    expect(JSON.stringify(failures)).not.toContain("secret detail");
  });

  it("does not start a tick while the previous tick is still running", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => gate.then(() => 0));
    const scheduler = startCleanupScheduler([{ name: "slow", run }], {
      intervalMs: 1000,
      clock: () => 0,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await scheduler.stop();
  });
});

databaseSuite("cleanup scheduler against Postgres", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  async function fixtures(now: () => number) {
    await sql`DELETE FROM idempotency_keys`;
    await sql`DELETE FROM rate_limits`;
    const idempotency = new PostgresIdempotencyStore(sql, {
      clock: now,
      replayRetentionMs: 1000,
    });
    const rateLimits = new PostgresRateLimitStore(sql);
    return { idempotency, rateLimits };
  }

  function schedulerFor(stores: Awaited<ReturnType<typeof fixtures>>, now: () => number) {
    return startCleanupScheduler(
      [
        {
          name: "idempotency_keys",
          run: (at, limit) => stores.idempotency.sweep(at, limit),
        },
        { name: "rate_limits", run: (at, limit) => stores.rateLimits.prune(at, limit) },
      ],
      { intervalMs: 1000, clock: now },
    );
  }

  it("removes expired rows on a tick and keeps active rows", async () => {
    let now = 1000;
    const stores = await fixtures(() => now);
    // Replay expires at 2000 and the bucket is full at 2000: both expired by t=10000.
    const reservation = await stores.idempotency.begin({
      key: "expired-replay",
      requestHash: "h",
      createdAt: 1000,
    });
    if (reservation.kind !== "new") throw new Error("Expected reservation");
    await stores.idempotency.complete(
      { key: "expired-replay", requestHash: "h", createdAt: 1000 },
      reservation.token,
      { status: 201, headers: [], bodyBase64: null },
    );
    await stores.rateLimits.consume("expired-bucket", { capacity: 1, refillMs: 1000 }, 1000);
    await stores.rateLimits.consume("active-bucket", { capacity: 1, refillMs: 1_000_000 }, 1000);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    now = 10_000;
    const scheduler = schedulerFor(stores, () => now);
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.stop();

    expect(await sql`SELECT key FROM idempotency_keys`).toEqual([]);
    expect((await sql`SELECT key FROM rate_limits`).map((row) => row.key)).toEqual([
      "active-bucket",
    ]);
  });

  it("stop() prevents later ticks from removing rows that expire afterwards", async () => {
    let now = 1000;
    const stores = await fixtures(() => now);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const scheduler = schedulerFor(stores, () => now);
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.stop();

    // Expires at 11000, after the scheduler has stopped.
    now = 10_000;
    await stores.rateLimits.consume("late-bucket", { capacity: 1, refillMs: 1000 }, 10_000);
    now = 20_000;
    await vi.advanceTimersByTimeAsync(3000);

    expect((await sql`SELECT key FROM rate_limits`).map((row) => row.key)).toEqual(["late-bucket"]);
  });
});
