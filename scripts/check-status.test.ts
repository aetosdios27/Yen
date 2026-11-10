import { describe, expect, it } from "vitest";
import {
  buildSelfTestPayload,
  collectStatus,
  configSchema,
  determineOverall,
  renderPayload,
  type StatusCheck,
  statusCheckSchema,
  statusPayloadSchema,
} from "./check-status.js";

const ok = (name: StatusCheck["name"], overrides: Partial<StatusCheck> = {}): StatusCheck =>
  statusCheckSchema.parse({ name, status: "ok", ...overrides });

describe("check-status payload structure", () => {
  it("accepts a valid payload", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v1",
      generatedAt: "2026-11-10T00:00:00.000Z",
      overall: "ok",
      checks: [{ name: "database", status: "ok", target: "db:5432", latencyMs: 3 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown check name", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v1",
      generatedAt: "2026-11-10T00:00:00.000Z",
      overall: "ok",
      checks: [{ name: "wallet", status: "ok" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid overall status", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v1",
      generatedAt: "2026-11-10T00:00:00.000Z",
      overall: "fine",
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a foreign schema version", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v2",
      generatedAt: "2026-11-10T00:00:00.000Z",
      overall: "ok",
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO generatedAt timestamp", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v1",
      generatedAt: "yesterday",
      overall: "ok",
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a check with an unknown status", () => {
    const result = statusPayloadSchema.safeParse({
      schema: "yen.status.v1",
      generatedAt: "2026-11-10T00:00:00.000Z",
      overall: "ok",
      checks: [{ name: "database", status: "unknown" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("determineOverall", () => {
  it("returns ok when every check is ok", () => {
    expect(determineOverall([ok("api_liveness"), ok("api_readiness"), ok("database")])).toBe("ok");
  });

  it("returns down when api liveness fails", () => {
    expect(determineOverall([ok("api_liveness", { status: "fail" })])).toBe("down");
  });

  it("returns down when the database fails", () => {
    expect(determineOverall([ok("database", { status: "fail" })])).toBe("down");
  });

  it("returns degraded when only auxiliary checks fail", () => {
    expect(
      determineOverall([ok("api_liveness"), ok("database"), ok("public_page", { status: "fail" })]),
    ).toBe("degraded");
  });

  it("returns degraded when nothing is configured", () => {
    expect(
      determineOverall([
        ok("api_liveness", { status: "skipped" }),
        ok("database", { status: "skipped" }),
      ]),
    ).toBe("degraded");
  });
});

describe("buildSelfTestPayload", () => {
  it("produces a payload that satisfies the status schema", () => {
    const payload = buildSelfTestPayload(new Date("2026-11-10T00:00:00.000Z"));
    expect(statusPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("covers every check name exactly once", () => {
    const payload = buildSelfTestPayload();
    expect(payload.checks.map((check) => check.name)).toEqual([
      "api_liveness",
      "api_readiness",
      "database",
      "public_page",
    ]);
  });

  it("marks the synthetic readiness failure", () => {
    const payload = buildSelfTestPayload();
    const readiness = payload.checks.find((check) => check.name === "api_readiness");
    expect(readiness?.status).toBe("fail");
    expect(readiness?.detail).toContain("synthetic failure");
  });
});

describe("collectStatus", () => {
  const config = configSchema.parse({
    STATUS_API_URL: "http://api.test",
    STATUS_TIMEOUT_MS: "1000",
  });

  const fetchJson = (routes: Record<string, { status: number }>) => {
    return (async (input: string) => {
      const path = new URL(input).pathname;
      const route = routes[path];
      if (!route) throw new Error(`unexpected probe target ${input}`);
      return new Response(null, { status: route.status });
    }) as typeof fetch;
  };

  it("reports ok when the API answers and the rest is unconfigured", async () => {
    const payload = await collectStatus(
      config,
      fetchJson({ "/health": { status: 200 }, "/ready": { status: 200 } }),
      async () => {},
    );
    expect(payload.overall).toBe("ok");
    expect(payload.checks.map((check) => [check.name, check.status])).toEqual([
      ["api_liveness", "ok"],
      ["api_readiness", "ok"],
      ["database", "skipped"],
      ["public_page", "skipped"],
    ]);
  });

  it("reports ok when the database and public page also pass", async () => {
    const payload = await collectStatus(
      configSchema.parse({
        STATUS_API_URL: "http://api.test",
        STATUS_DATABASE_URL: "postgres://user:secret@db.test:5432/yen",
        STATUS_PUBLIC_PAGE_URL: "https://page.test/fund",
        STATUS_TIMEOUT_MS: "1000",
      }),
      fetchJson({
        "/health": { status: 200 },
        "/ready": { status: 200 },
        "/fund": { status: 200 },
      }),
      async () => {},
    );
    expect(payload.overall).toBe("ok");
    const database = payload.checks.find((check) => check.name === "database");
    expect(database?.target).toBe("db.test:5432");
  });

  it("reports down when the api liveness probe errors", async () => {
    const payload = await collectStatus(
      config,
      (async () => {
        throw new Error("connection refused");
      }) as typeof fetch,
      async () => {},
    );
    expect(payload.overall).toBe("down");
    const liveness = payload.checks.find((check) => check.name === "api_liveness");
    expect(liveness?.status).toBe("fail");
    expect(liveness?.detail).toBe("connection refused");
  });

  it("reports degraded when readiness returns 503", async () => {
    const payload = await collectStatus(
      config,
      fetchJson({ "/health": { status: 200 }, "/ready": { status: 503 } }),
      async () => {},
    );
    expect(payload.overall).toBe("degraded");
    const readiness = payload.checks.find((check) => check.name === "api_readiness");
    expect(readiness?.status).toBe("fail");
    expect(readiness?.detail).toBe("HTTP 503");
  });

  it("records database failures with the host only, never credentials", async () => {
    const payload = await collectStatus(
      configSchema.parse({
        STATUS_API_URL: "http://api.test",
        STATUS_DATABASE_URL: "postgres://user:secret@db.test:5432/yen",
        STATUS_TIMEOUT_MS: "1000",
      }),
      fetchJson({ "/health": { status: 200 }, "/ready": { status: 200 } }),
      async () => {
        throw new Error("password authentication failed");
      },
    );
    const database = payload.checks.find((check) => check.name === "database");
    expect(database?.status).toBe("fail");
    expect(database?.target).toBe("db.test:5432");
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});

describe("renderPayload", () => {
  it("emits JSON that round-trips to the same payload", () => {
    const payload = buildSelfTestPayload(new Date("2026-11-10T00:00:00.000Z"));
    expect(JSON.parse(renderPayload(payload))).toEqual(payload);
  });
});
