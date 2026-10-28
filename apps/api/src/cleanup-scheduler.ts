/**
 * Periodic retention cleanup for the shared Postgres stores.
 * The stores only reclaim expired rows when `sweep()` or `prune()` is called, so the
 * production entrypoint runs them on an interval. Each call is bounded by `batchLimit`
 * (`FOR UPDATE SKIP LOCKED ... LIMIT`), so one tick never deletes an unbounded number of rows.
 * Node timers: https://nodejs.org/api/timers.html#timeoutunref
 */

export interface CleanupTask {
  readonly name: string;
  run(now: number, limit: number): Promise<number>;
}

export interface CleanupFailure {
  readonly event: "cleanup_failed";
  readonly task: string;
  readonly errorName: string;
}

export interface CleanupSchedulerOptions {
  readonly intervalMs: number;
  readonly batchLimit?: number;
  readonly clock?: () => number;
  readonly onFailure?: (failure: CleanupFailure) => void;
}

export interface CleanupScheduler {
  /** Stops future ticks. Resolves once a tick that already started has finished. Idempotent. */
  stop(): Promise<void>;
}

export const DEFAULT_CLEANUP_BATCH_LIMIT = 1000;

/**
 * Runs every task once per interval. A tick is skipped while the previous tick is still running,
 * so slow queries never stack up. A failing task is reported through `onFailure` and never throws.
 */
export function startCleanupScheduler(
  tasks: readonly CleanupTask[],
  options: CleanupSchedulerOptions,
): CleanupScheduler {
  const clock = options.clock ?? Date.now;
  const batchLimit = options.batchLimit ?? DEFAULT_CLEANUP_BATCH_LIMIT;
  const onFailure = options.onFailure ?? (() => {});
  let stopped = false;
  let inFlight: Promise<void> | undefined;

  const runTick = async (): Promise<void> => {
    for (const task of tasks) {
      try {
        await task.run(clock(), batchLimit);
      } catch (error) {
        onFailure({
          event: "cleanup_failed",
          task: task.name,
          errorName: error instanceof Error ? error.constructor.name : "unknown",
        });
      }
    }
  };

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = runTick().finally(() => {
      inFlight = undefined;
    });
  }, options.intervalMs);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
