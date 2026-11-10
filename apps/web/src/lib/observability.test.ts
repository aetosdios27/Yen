import { afterEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "./observability";

const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const originalRelease = process.env.NEXT_PUBLIC_RELEASE_SHA;

afterEach(() => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  process.env.NEXT_PUBLIC_RELEASE_SHA = originalRelease;
  vi.restoreAllMocks();
});

describe("client error reporting", () => {
  it("stays silent without a DSN", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportClientError(new Error("boom"));
    expect(error).not.toHaveBeenCalled();
  });

  it("logs a report tagged with the release when a DSN is configured", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.example/1";
    process.env.NEXT_PUBLIC_RELEASE_SHA = "abc123";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportClientError(new Error("boom"), { route: "/funds/abc", requestId: "req-1" });

    expect(error).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "client_error",
      release: "abc123",
      route: "/funds/abc",
      requestId: "req-1",
      errorName: "Error",
      message: "boom",
    });
  });
});
