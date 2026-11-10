import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { type LogEntry, logMethod, redactLogText, serializeRequestLog } from "./logging.js";

const requestId = "00000000-0000-4000-8000-000000000001";

const secrets = [
  "+919876543210",
  "9876543210",
  "committee@yenbank",
  "Bearer secret-token-value",
  "password=hunter2",
  "pin: 4821",
  "otp=135790",
  "token=abc123",
  "api_key=sk-live-1",
];

describe("log redaction", () => {
  it.each(secrets)("removes %s from free text", (secret) => {
    const redacted = redactLogText(`GET /v1/funds?value=${secret}`);
    for (const fragment of ["9876543210", "committee@yenbank", "hunter2", "4821", "135790"]) {
      expect(redacted).not.toContain(fragment);
    }
    expect(redacted).not.toMatch(/hunter2|secret-token-value|abc123|sk-live-1/);
  });

  it("keeps templated routes readable", () => {
    expect(redactLogText("/v1/funds/:fundId/public/summary")).toBe(
      "/v1/funds/:fundId/public/summary",
    );
  });

  it("redacts contact details on a failure entry without dropping the route", () => {
    const entry: LogEntry = {
      event: "http_failure",
      requestId,
      method: "POST",
      route: "/v1/funds/00000000-0000-4000-8000-000000000010/donations/pledge",
      errorKind: "store",
      errorName: "Error calling +919876543210 via committee@yenbank",
    };
    const parsed = JSON.parse(serializeRequestLog(entry)) as { errorName: string; route: string };
    expect(parsed.errorName).not.toContain("919876543210");
    expect(parsed.errorName).not.toContain("committee@yenbank");
    expect(parsed.route).toContain("/donations/pledge");
  });

  it("keeps every log entry inside the documented schema", () => {
    expect(() =>
      serializeRequestLog({
        event: "http_request",
        requestId,
        method: "POST",
        route: "/v1/funds/:fundId/donations/pledge",
        status: 201,
        durationMs: 12,
      }),
    ).not.toThrow();
    const serialized = serializeRequestLog({
      event: "http_request",
      requestId,
      method: "GET",
      route: "/v1/me",
      status: 200,
      durationMs: 1,
      body: { phone: "+919876543210" },
    } as unknown as LogEntry);
    expect(serialized).not.toContain("919876543210");
    expect(JSON.parse(serialized)).not.toHaveProperty("body");
  });

  it("normalises unknown HTTP verbs", () => {
    expect(logMethod("TRACE")).toBe("OTHER");
    expect(logMethod("POST")).toBe("POST");
  });
});

describe("request logs", () => {
  it("never writes a contact detail a caller put in the URL", async () => {
    const lines: string[] = [];
    const app = createApp({ logger: { log: (entry) => lines.push(serializeRequestLog(entry)) } });
    const response = await app.request("/version?phone=%2B919876543210&vpa=committee%40yenbank");
    expect(response.status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    const written = lines.join("\n");
    expect(written).not.toContain("919876543210");
    expect(written).not.toContain("committee@yenbank");
    const first = lines[0];
    expect(first).toBeDefined();
    const entry = JSON.parse(first ?? "{}") as { event: string; requestId: string };
    expect(entry.event).toBe("http_request");
    expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
