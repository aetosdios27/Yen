import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createErrorReporter } from "./error-reporter.js";
import { collectHealth } from "./health.js";
import { createFaultTracker } from "./runtime-faults.js";

describe("collectHealth", () => {
  it("reports every probe and stays ok when all of them pass", async () => {
    const report = await collectHealth(
      [
        { name: "database", run: async () => true },
        { name: "queue", run: async () => true },
      ],
      () => null,
    );
    expect(report.status).toBe("ok");
    expect(report.checks).toEqual([
      { name: "database", status: "ok" },
      { name: "queue", status: "ok" },
    ]);
  });

  it("degrades and names the dependency that failed", async () => {
    const report = await collectHealth(
      [
        { name: "database", run: async () => true },
        { name: "queue", run: async () => false },
      ],
      () => null,
    );
    expect(report.status).toBe("degraded");
    expect(report.checks).toContainEqual({ name: "queue", status: "fail" });
  });

  it("treats a probe that throws as failed rather than healthy", async () => {
    const report = await collectHealth(
      [
        {
          name: "database",
          run: async () => {
            throw new Error("connection reset");
          },
        },
      ],
      () => null,
    );
    expect(report.status).toBe("degraded");
    expect(report.checks).toEqual([{ name: "database", status: "fail" }]);
  });

  it("degrades when a runtime fault was recorded", async () => {
    const report = await collectHealth(
      [{ name: "database", run: async () => true }],
      () => "unhandled_rejection",
    );
    expect(report.status).toBe("degraded");
    expect(report.checks).toContainEqual({ name: "runtime", status: "fail" });
  });
});

describe("runtime fault tracker", () => {
  it("records the first unhandled rejection and clears on demand", () => {
    const tracker = createFaultTracker();
    const uninstall = tracker.install();
    try {
      expect(tracker.current()).toBeNull();
      process.emit("unhandledRejection", new Error("lost work"), Promise.resolve());
      expect(tracker.current()).toBe("unhandled_rejection");
      tracker.clear();
      expect(tracker.current()).toBeNull();
    } finally {
      uninstall();
    }
  });

  it("removes its listener on uninstall", () => {
    const before = process.listenerCount("unhandledRejection");
    const tracker = createFaultTracker();
    const uninstall = tracker.install();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    uninstall();
    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });
});

describe("health routes", () => {
  it("answers liveness with named checks", async () => {
    const app = createApp();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: [{ name: "process", status: "ok" }],
    });
  });

  it("fails liveness only on a recorded runtime fault", async () => {
    const app = createApp({ runtimeFault: () => "unhandled_rejection" });
    const response = await app.request("/health");
    expect(response.status).toBe(503);
  });

  it("reads readiness from the injected deep probe", async () => {
    const app = createApp({
      health: async () => ({
        status: "degraded",
        checks: [
          { name: "database", status: "ok" },
          { name: "queue", status: "fail" },
        ],
      }),
    });
    const response = await app.request("/ready");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
  });

  it("returns the checks when everything is healthy", async () => {
    const app = createApp({
      health: async () => ({ status: "ok", checks: [{ name: "database", status: "ok" }] }),
    });
    const response = await app.request("/ready");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: [{ name: "database", status: "ok" }],
    });
  });

  it("falls back to the readiness probe when no deep probe is configured", async () => {
    const app = createApp({ readiness: async () => false });
    expect((await app.request("/ready")).status).toBe(503);
  });
});

describe("error reports", () => {
  it("captures server failures from a route", async () => {
    const bodies: string[] = [];
    const app = createApp({
      errorReporter: createErrorReporter({
        dsn: "https://key@sentry.example/1",
        transport: async (_url, _headers, body) => {
          bodies.push(body);
        },
      }),
    });
    app.get("/boom", () => {
      throw new Error("handler exploded");
    });
    expect((await app.request("/boom")).status).toBe(500);
    expect(bodies.join("\n")).toContain("handler exploded");
  });

  it("does not report a 4xx", async () => {
    const capture = vi.fn();
    const app = createApp({ errorReporter: { capture } });
    expect((await app.request("/v1/me")).status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });
});
