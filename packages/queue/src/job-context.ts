import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type JobContext = {
  readonly jobId: string;
  readonly queue: string;
  readonly requestId: string;
  readonly traceId: string;
};

const storage = new AsyncLocalStorage<JobContext>();

/** Correlation ids for the job currently running on this async path. */
export function currentJobContext(): JobContext | undefined {
  return storage.getStore();
}

export function createJobContext(input: { jobId: string; queue: string }): JobContext {
  return {
    jobId: input.jobId,
    queue: input.queue,
    requestId: randomUUID(),
    traceId: randomUUID().replaceAll("-", ""),
  };
}

/**
 * Runs a job handler with its own request and trace ids, so a log line written
 * anywhere inside the handler can be joined with the work that queued it
 * without threading an argument through every handler.
 */
export function withJobContext<T>(context: JobContext, work: () => Promise<T>): Promise<T> {
  return storage.run(context, work);
}

export type JobLogEntry = {
  readonly event: "queue_job";
  readonly outcome: "completed" | "failed";
  readonly durationMs: number;
  readonly errorName?: string;
};

/** One JSON line per job, carrying ids only: never the payload. */
export function writeJobLog(entry: JobLogEntry, context: JobContext): void {
  process.stdout.write(
    `${JSON.stringify({
      ...entry,
      jobId: context.jobId,
      queue: context.queue,
      requestId: context.requestId,
      traceId: context.traceId,
    })}\n`,
  );
}
