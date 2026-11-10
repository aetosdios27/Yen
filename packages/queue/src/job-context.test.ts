import { describe, expect, it, vi } from "vitest";
import {
  createJobContext,
  currentJobContext,
  type JobLogEntry,
  withJobContext,
  writeJobLog,
} from "./job-context.js";

const context = createJobContext({ jobId: "job-1", queue: "notifications" });

describe("job context", () => {
  it("creates a uuid request id and a 32 hex trace id per job", () => {
    expect(context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    const other = createJobContext({ jobId: "job-2", queue: "notifications" });
    expect(other.requestId).not.toBe(context.requestId);
  });

  it("exposes the ids inside the handler and cleanly outside it", async () => {
    expect(currentJobContext()).toBeUndefined();
    const seen = await withJobContext(context, async () => {
      await Promise.resolve();
      return currentJobContext();
    });
    expect(seen).toEqual(context);
    expect(currentJobContext()).toBeUndefined();
  });

  it("keeps concurrent jobs on separate contexts", async () => {
    const first = createJobContext({ jobId: "job-a", queue: "reconciliation" });
    const second = createJobContext({ jobId: "job-b", queue: "reconciliation" });
    const observed = await Promise.all([
      withJobContext(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentJobContext()?.jobId;
      }),
      withJobContext(second, async () => currentJobContext()?.jobId),
    ]);
    expect(observed).toEqual(["job-a", "job-b"]);
  });

  it("writes one id-only JSON line per job", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const entry: JobLogEntry = { event: "queue_job", outcome: "failed", durationMs: 12 };
      writeJobLog(entry, context);
      const line = write.mock.calls[0]?.[0];
      expect(typeof line).toBe("string");
      const parsed = JSON.parse(line as string) as Record<string, unknown>;
      expect(parsed).toEqual({
        event: "queue_job",
        outcome: "failed",
        durationMs: 12,
        jobId: "job-1",
        queue: "notifications",
        requestId: context.requestId,
        traceId: context.traceId,
      });
      expect(Object.keys(parsed)).not.toContain("data");
    } finally {
      write.mockRestore();
    }
  });
});
