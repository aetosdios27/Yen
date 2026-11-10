import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  createErrorReporter,
  createStdoutErrorReporter,
  parseSentryDsn,
} from "./error-reporter.js";

const COMMIT_SHA = "a71a130aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DSN = "https://publickey@example.sentry.io/42";
const FLUSH_MICROTASKS = () => new Promise<void>((resolve) => setImmediate(resolve));

type CapturedDispatch = { url: string; headers: Record<string, string>; body: string };

function recordingTransport(captured: CapturedDispatch[]) {
  return async (url: string, headers: Record<string, string>, body: string): Promise<void> => {
    captured.push({ url, headers, body });
  };
}

function parseEnvelope(body: string) {
  const [header, item, event] = body
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (!header || !item || !event) throw new Error("malformed envelope body");
  return { header, item, event };
}

it("stays silent without a DSN", () => {
  const write = vi.fn();
  const transport = vi.fn();
  const reporter = createErrorReporter({ write, transport: transport as never });
  reporter.capture(new Error("boom"), { requestId: "r", route: "/v1/me", status: 500 });
  expect(write).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("falls back to the stdout reporter on a malformed DSN", () => {
  const lines: string[] = [];
  const transport = vi.fn();
  const reporter = createErrorReporter({
    dsn: "not-a-dsn",
    release: COMMIT_SHA,
    write: (line) => lines.push(line),
    transport: transport as never,
  });
  reporter.capture(new Error("boom"), { requestId: "r", route: "/v1/me", status: 500 });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
    event: "error_report",
    release: COMMIT_SHA,
  });
  expect(transport).not.toHaveBeenCalled();
});

it("dispatches staging exceptions to the envelope endpoint with the commit SHA release and a scrubbed payload", () => {
  const captured: CapturedDispatch[] = [];
  const reporter = createErrorReporter({
    dsn: DSN,
    release: COMMIT_SHA,
    environment: "staging",
    transport: recordingTransport(captured),
    timestamp: () => "2026-11-11T00:00:00.000Z",
  });

  reporter.capture(
    new Error(
      "payout failed for +919876543210, vpa committee@yenbank, token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ),
    {
      requestId: "00000000-0000-4000-8000-000000000001",
      route: "/v1/funds/:fundId/public/summary",
      status: 500,
      traceId: "11111111111111111111111111111111",
      extra: {
        password: "hunter2",
        cookie: "yen_session=abcdef123456",
        body: { phone: "9876543210", amount: 50000 },
      },
    },
  );

  expect(captured).toHaveLength(1);
  const dispatch = captured[0] as CapturedDispatch;
  expect(dispatch.url).toBe("https://example.sentry.io/api/42/envelope/");
  expect(dispatch.headers["content-type"]).toBe("application/x-sentry-envelope");
  expect(dispatch.headers["x-sentry-auth"]).toContain("sentry_key=publickey");

  const { header, item, event } = parseEnvelope(dispatch.body);
  expect(header.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(item).toEqual({ type: "event" });
  expect(event).toMatchObject({
    platform: "node",
    level: "error",
    release: COMMIT_SHA,
    environment: "staging",
    message: { formatted: expect.stringContaining("payout failed for [redacted:phone]") },
  });

  const serialized = dispatch.body;
  expect(serialized).not.toContain("919876543210");
  expect(serialized).not.toContain("9876543210");
  expect(serialized).not.toContain("committee@yenbank");
  expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  expect(serialized).not.toContain("hunter2");
  expect(serialized).not.toContain("abcdef123456");
  expect(serialized).toContain("/v1/funds/:fundId/public/summary");
  expect(event.message).toEqual({
    formatted: expect.not.stringContaining("919876543210"),
  });
});

it("carries request metadata and scrubbed extras in the event", () => {
  const captured: CapturedDispatch[] = [];
  const reporter = createErrorReporter({
    dsn: DSN,
    release: COMMIT_SHA,
    environment: "staging",
    transport: recordingTransport(captured),
  });
  reporter.capture(new Error("boom"), {
    requestId: "00000000-0000-4000-8000-000000000002",
    route: "/v1/funds/:fundId/public/summary",
    status: 503,
    traceId: "22222222222222222222222222222222",
    extra: { password: "hunter2", body: { phone: "9876543210", amount: 50000 } },
  });

  const { event } = parseEnvelope(captured[0]?.body ?? "");
  expect(event.tags).toMatchObject({
    request_id: "00000000-0000-4000-8000-000000000002",
    route: "/v1/funds/:fundId/public/summary",
    status: "503",
    trace_id: "22222222222222222222222222222222",
  });
  const extra = event.extra as { password: string; body: { phone: string; amount: number } };
  expect(extra.password).toBe("[redacted]");
  expect(extra.body.phone).toBe("[redacted]");
  expect(extra.body.amount).toBe(50000);
});

it("writes the scrubbed stdout line when dispatch fails", async () => {
  const lines: string[] = [];
  const reporter = createErrorReporter({
    dsn: DSN,
    release: COMMIT_SHA,
    environment: "staging",
    write: (line) => lines.push(line),
    transport: async () => {
      throw new Error("sentry unreachable");
    },
  });
  reporter.capture(new Error("could not reach +919876543210 or committee@yenbank"), {
    requestId: "00000000-0000-4000-8000-000000000003",
    route: "/v1/funds/:fundId/public/summary",
    status: 500,
    traceId: "33333333333333333333333333333333",
  });

  await FLUSH_MICROTASKS();
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  expect(parsed).toMatchObject({
    event: "error_report",
    release: COMMIT_SHA,
    environment: "staging",
    requestId: "00000000-0000-4000-8000-000000000003",
    traceId: "33333333333333333333333333333333",
    status: 500,
    errorName: "Error",
  });
  expect(lines[0]).not.toContain("919876543210");
  expect(lines[0]).not.toContain("committee@yenbank");
});

it("never lets a transport throw out of capture", () => {
  const reporter = createErrorReporter({
    dsn: DSN,
    transport: () => {
      throw new Error("sync transport failure");
    },
  });
  expect(() =>
    reporter.capture(new Error("boom"), { requestId: "r", route: "/v1/me", status: 500 }),
  ).not.toThrow();
});

describe("parseSentryDsn", () => {
  it("parses https DSNs into the envelope endpoint", () => {
    expect(parseSentryDsn("https://key@sentry.example/1")).toEqual({
      envelopeUrl: "https://sentry.example/api/1/envelope/",
      publicKey: "key",
    });
  });

  it("parses http DSNs for self-hosted Sentry", () => {
    expect(parseSentryDsn("http://key@sentry.internal/7")).toEqual({
      envelopeUrl: "http://sentry.internal/api/7/envelope/",
      publicKey: "key",
    });
  });

  it("rejects DSNs without a numeric project id", () => {
    expect(parseSentryDsn("https://key@sentry.example/proj")).toBeNull();
    expect(parseSentryDsn("https://sentry.example/1")).toBeNull();
    expect(parseSentryDsn("ftp://key@sentry.example/1")).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
  });
});

describe("stdout fallback reporter", () => {
  it("writes a scrubbed report tagged with the release", () => {
    const lines: string[] = [];
    const reporter = createStdoutErrorReporter({
      release: "abc123",
      environment: "production",
      write: (line) => lines.push(line),
    });
    reporter.capture(new Error("could not reach +919876543210 or committee@yenbank"), {
      requestId: "00000000-0000-4000-8000-000000000001",
      route: "/v1/funds/:fundId/public/summary",
      status: 500,
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "error_report",
      release: "abc123",
      environment: "production",
      status: 500,
      errorName: "Error",
    });
    expect(lines[0]).not.toContain("919876543210");
    expect(lines[0]).not.toContain("committee@yenbank");
  });

  it("scrubs extras before the log stream sees them", () => {
    const lines: string[] = [];
    const reporter = createStdoutErrorReporter({ write: (line) => lines.push(line) });
    reporter.capture(new Error("boom"), {
      requestId: "r",
      route: "/v1/me",
      status: 500,
      extra: { password: "hunter2", note: "fund f_1 at 50000 paise" },
    });
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).toContain("fund f_1 at 50000 paise");
  });
});

it("captures server failures from a route through the transport", async () => {
  const captured: CapturedDispatch[] = [];
  const app = createApp({
    errorReporter: createErrorReporter({
      dsn: DSN,
      release: COMMIT_SHA,
      environment: "staging",
      transport: recordingTransport(captured),
    }),
  });
  app.get("/boom", () => {
    throw new Error("handler exploded");
  });
  expect((await app.request("/boom")).status).toBe(500);
  const { event } = parseEnvelope(captured[0]?.body ?? "");
  expect(event.release).toBe(COMMIT_SHA);
  expect(event.message).toMatchObject({ formatted: "handler exploded" });
});
