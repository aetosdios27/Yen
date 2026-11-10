import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientRelease,
  installClientObservability,
  reportClientError,
  scrubRoute,
} from "./observability";

const originalEnv: Record<string, string | undefined> = {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_RELEASE_SHA: process.env.NEXT_PUBLIC_RELEASE_SHA,
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("clientRelease", () => {
  it("prefers the Vercel commit SHA", () => {
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "a71a130commitsha";
    process.env.NEXT_PUBLIC_RELEASE_SHA = "fallback-sha";
    expect(clientRelease()).toBe("a71a130commitsha");
  });

  it("falls back to NEXT_PUBLIC_RELEASE_SHA and then unknown", () => {
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    process.env.NEXT_PUBLIC_RELEASE_SHA = "fallback-sha";
    expect(clientRelease()).toBe("fallback-sha");
    delete process.env.NEXT_PUBLIC_RELEASE_SHA;
    expect(clientRelease()).toBe("unknown");
  });
});

describe("scrubRoute", () => {
  it("drops query strings and fragments", () => {
    expect(scrubRoute("/funds/abc?phone=%2B919876543210&vpa=shop@paytm#section")).toBe(
      "/funds/abc",
    );
  });

  it("scrubs personal data left in the path", () => {
    expect(scrubRoute("/funds/9876543210")).toBe("/funds/[redacted:phone]");
  });
});

describe("client error reporting", () => {
  it("stays silent without a DSN", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    reportClientError(new Error("boom"));
    expect(error).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a scrubbed report tagged with the release when a DSN is configured", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.example/1";
    process.env.NEXT_PUBLIC_RELEASE_SHA = "abc123";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    reportClientError(new Error("pledge failed for 9876543210 vpa committee@yenbank"), {
      route: "/funds/abc?phone=%2B919876543210",
      requestId: "req-1",
    });

    expect(error).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "client_error",
      release: "abc123",
      route: "/funds/abc",
      requestId: "req-1",
      errorName: "Error",
      message: "pledge failed for [redacted:phone] vpa [redacted:vpa]",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dispatch = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(dispatch[0]).toBe("https://sentry.example/api/1/envelope/");
    expect(String(dispatch[1]?.body)).toContain("pledge failed for [redacted:phone]");
  });

  it("dispatches a scrubbed envelope to the Sentry endpoint", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://publickey@sentry.example/42";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "a71a130websha";
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "staging";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    reportClientError(
      new Error(
        "session token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c expired",
      ),
      { route: "/funds/abc", requestId: "req-2" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sentry.example/api/42/envelope/");
    expect(init.headers).toMatchObject({
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": expect.stringContaining("sentry_key=publickey"),
    });
    const serialized = bodies.join("\n");
    expect(serialized).toContain("a71a130websha");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).toContain("staging");
    const lines = bodies[0]?.split("\n").filter((line) => line !== "") ?? [];
    expect(JSON.parse(lines[2] ?? "{}")).toMatchObject({
      platform: "javascript",
      level: "error",
      release: "a71a130websha",
      environment: "staging",
      tags: { route: "/funds/abc", request_id: "req-2" },
    });
  });

  it("scrubs extra context objects", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.example/1";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn());

    reportClientError(new Error("boom"), {
      extra: { password: "hunter2", body: { phone: "+919876543210", amount: 500 } },
    });

    const payload = JSON.parse(String(error.mock.calls[0]?.[0])) as {
      extra: { password: string; body: { phone: string } };
    };
    expect(payload.extra.password).toBe("[redacted]");
    expect(payload.extra.body.phone).toBe("[redacted]");
  });

  it("survives a rejecting transport", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.example/1";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(() => reportClientError(new Error("boom"))).not.toThrow();
  });
});

describe("installClientObservability", () => {
  function fakeWindow(pathname = "/funds/abc") {
    const handlers = new Map<string, (event: never) => void>();
    const listeners = {
      location: { pathname },
      addEventListener: vi.fn((type: string, handler: (event: never) => void) => {
        handlers.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string) => {
        handlers.delete(type);
      }),
    };
    return { handlers, window: listeners as unknown as Window };
  }

  it("installs error and rejection handlers that report scrubbed events", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.example/1";
    process.env.NEXT_PUBLIC_RELEASE_SHA = "abc123";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const { handlers, window } = fakeWindow();

    const cleanup = installClientObservability(window);
    expect(handlers.has("error")).toBe(true);
    expect(handlers.has("unhandledrejection")).toBe(true);

    const errorEvent = { error: new Error("boom"), message: "boom" } as ErrorEvent;
    handlers.get("error")?.(errorEvent as never);
    const rejectionEvent = {
      reason: new Error("async 9876543210 leak"),
      promise: Promise.resolve(),
    } as PromiseRejectionEvent;
    handlers.get("unhandledrejection")?.(rejectionEvent as never);

    const payloads = error.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
    expect(payloads[0]).toMatchObject({
      event: "client_error",
      release: "abc123",
      route: "/funds/abc",
      message: "boom",
    });
    expect(payloads[1]?.message).toContain("[redacted:phone]");

    cleanup();
    expect(handlers.has("error")).toBe(false);
    expect(handlers.has("unhandledrejection")).toBe(false);
  });

  it("is idempotent per window", () => {
    const { window } = fakeWindow();
    const first = installClientObservability(window);
    expect(() => installClientObservability(window)).not.toThrow();
    first();
    const third = installClientObservability(window);
    third();
  });

  it("returns a no-op cleanup outside a window", () => {
    expect(() => installClientObservability(undefined)).not.toThrow();
  });
});
