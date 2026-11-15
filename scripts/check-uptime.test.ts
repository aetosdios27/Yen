import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAlertPayload,
  buildSelfTestPayload,
  collectUptime,
  configSchema,
  determineOverall,
  dispatchAlert,
  readAlertState,
  shouldSendAlert,
  type UptimeCheck,
  uptimeAlertSchema,
  uptimeCheckSchema,
  uptimePayloadSchema,
  writeAlertState,
} from "./check-uptime.js";

const ok = (name: UptimeCheck["name"], overrides: Partial<UptimeCheck> = {}): UptimeCheck =>
  uptimeCheckSchema.parse({ name, status: "ok", ...overrides });

describe("check-uptime payload structure", () => {
  it("accepts a valid payload", () => {
    const result = uptimePayloadSchema.safeParse({
      schema: "yen.uptime.v1",
      generatedAt: "2026-11-11T00:00:00.000Z",
      overall: "up",
      checks: [{ name: "web_home", status: "ok", target: "http://web", latencyMs: 3 }],
      alert: { dispatched: true, windowMs: 300000 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown check name", () => {
    const result = uptimePayloadSchema.safeParse({
      schema: "yen.uptime.v1",
      generatedAt: "2026-11-11T00:00:00.000Z",
      overall: "up",
      checks: [{ name: "wallet", status: "ok" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid overall status", () => {
    const result = uptimePayloadSchema.safeParse({
      schema: "yen.uptime.v1",
      generatedAt: "2026-11-11T00:00:00.000Z",
      overall: "fine",
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a foreign schema version", () => {
    const result = uptimePayloadSchema.safeParse({
      schema: "yen.uptime.v2",
      generatedAt: "2026-11-11T00:00:00.000Z",
      overall: "up",
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an alert with an unknown field type", () => {
    const result = uptimeAlertSchema.safeParse({ dispatched: "yes", windowMs: 300000 });
    expect(result.success).toBe(false);
  });
});

describe("determineOverall", () => {
  it("returns up when every check is ok", () => {
    expect(determineOverall([ok("web_home"), ok("api_liveness"), ok("api_readiness")])).toBe("up");
  });

  it("returns down when the web home fails", () => {
    expect(determineOverall([ok("web_home", { status: "fail" })])).toBe("down");
  });

  it("returns down when api readiness fails", () => {
    expect(determineOverall([ok("api_readiness", { status: "fail" })])).toBe("down");
  });

  it("returns degraded when only the public fund page fails", () => {
    expect(
      determineOverall([
        ok("web_home"),
        ok("api_liveness"),
        ok("fund_public_page", { status: "fail" }),
      ]),
    ).toBe("degraded");
  });

  it("returns degraded when nothing is configured", () => {
    expect(
      determineOverall([
        ok("web_home", { status: "skipped" }),
        ok("api_liveness", { status: "skipped" }),
      ]),
    ).toBe("degraded");
  });
});

describe("shouldSendAlert", () => {
  const windowMs = 5 * 60 * 1000;
  const now = 1_000_000;

  it("alerts on the first failure", () => {
    expect(shouldSendAlert(true, null, now, windowMs)).toBe(true);
  });

  it("suppresses a repeat alert inside the window", () => {
    expect(shouldSendAlert(true, now - windowMs + 1000, now, windowMs)).toBe(false);
  });

  it("alerts again once the window has elapsed", () => {
    expect(shouldSendAlert(true, now - windowMs, now, windowMs)).toBe(true);
    expect(shouldSendAlert(true, now - windowMs - 1, now, windowMs)).toBe(true);
  });

  it("never alerts when every probe passed", () => {
    expect(shouldSendAlert(false, null, now, windowMs)).toBe(false);
    expect(shouldSendAlert(false, now - windowMs * 10, now, windowMs)).toBe(false);
  });
});

describe("alert state persistence", () => {
  it("round trips the last alert timestamp through a state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "yen-uptime-"));
    try {
      const path = join(dir, "nested", "state.json");
      expect(readAlertState(path)).toEqual({ lastAlertAt: null });
      writeAlertState(path, { lastAlertAt: 123456 });
      expect(readAlertState(path)).toEqual({ lastAlertAt: 123456 });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ lastAlertAt: 123456 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to no last alert on a corrupt state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "yen-uptime-"));
    try {
      const path = join(dir, "state.json");
      writeFileSync(path, "not json");
      expect(readAlertState(path)).toEqual({ lastAlertAt: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("collectUptime", () => {
  const config = configSchema.parse({
    UPTIME_WEB_URL: "http://web.test",
    UPTIME_API_URL: "http://api.test",
    UPTIME_FUND_ID: "f_123",
    UPTIME_WEBHOOK_URL: "http://hooks.test/alert",
  });

  const responding =
    (statusByPath: Map<string, number>) =>
    (input: string): Promise<Response> => {
      const path = new URL(input).pathname;
      const status = statusByPath.get(path) ?? 404;
      return Promise.resolve(new Response(null, { status }));
    };

  it("probes web home, api health, ready and the public fund summary", async () => {
    const requested: string[] = [];
    const fetchLike = (input: string): Promise<Response> => {
      requested.push(input);
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    const payload = await collectUptime(config, fetchLike);
    expect(requested).toEqual([
      "http://web.test",
      "http://api.test/health",
      "http://api.test/ready",
      "http://api.test/v1/funds/f_123/public/summary",
    ]);
    expect(payload.overall).toBe("up");
    expect(payload.checks.map((check) => check.name)).toEqual([
      "web_home",
      "api_liveness",
      "api_readiness",
      "fund_public_page",
    ]);
    expect(payload.schema).toBe("yen.uptime.v1");
  });

  it("skips the fund probe without a fund id", async () => {
    const payload = await collectUptime(configSchema.parse({}), responding(new Map()));
    expect(payload.checks).toContainEqual({ name: "fund_public_page", status: "skipped" });
  });

  it("marks a probe failed on a non 2xx response with the status in the detail", async () => {
    const payload = await collectUptime(
      config,
      responding(
        new Map([
          ["/", 200],
          ["/health", 500],
        ]),
      ),
    );
    expect(payload.overall).toBe("down");
    const liveness = payload.checks.find((check) => check.name === "api_liveness");
    expect(liveness).toMatchObject({ status: "fail", detail: "HTTP 500" });
  });

  it("marks a probe failed when the target is unreachable", async () => {
    const payload = await collectUptime(config, () =>
      Promise.reject(new Error("connect ECONNREFUSED")),
    );
    expect(payload.overall).toBe("down");
    expect(payload.checks.every((check) => check.status === "fail")).toBe(true);
  });
});

describe("buildSelfTestPayload", () => {
  it("parses against the payload schema", () => {
    const payload = buildSelfTestPayload(new Date("2026-11-11T00:00:00.000Z"));
    expect(payload.generatedAt).toBe("2026-11-11T00:00:00.000Z");
    expect(payload.overall).toBe("down");
    expect(payload.alert).toEqual({ dispatched: false, windowMs: 300000 });
    expect(uptimePayloadSchema.safeParse(payload).success).toBe(true);
  });
});

describe("alert webhook", () => {
  it("summarizes only failed checks", () => {
    const payload = buildSelfTestPayload();
    const alert = buildAlertPayload(payload);
    expect(alert).toMatchObject({
      schema: "yen.uptime.v1",
      overall: "down",
      failedChecks: [
        {
          name: "api_readiness",
          detail: "synthetic failure for schema validation",
        },
      ],
    });
  });

  it("returns true only when the webhook accepts the payload", async () => {
    const payload = buildAlertPayload(buildSelfTestPayload());
    expect(
      await dispatchAlert("http://hooks.test", payload, () =>
        Promise.resolve(new Response(null, { status: 200 })),
      ),
    ).toBe(true);
    expect(
      await dispatchAlert("http://hooks.test", payload, () =>
        Promise.resolve(new Response(null, { status: 500 })),
      ),
    ).toBe(false);
    expect(
      await dispatchAlert("http://hooks.test", payload, () =>
        Promise.reject(new Error("dns fail")),
      ),
    ).toBe(false);
  });
});
