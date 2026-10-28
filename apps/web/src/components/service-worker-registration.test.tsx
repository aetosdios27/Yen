import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./service-worker-registration";

describe("ServiceWorkerRegistration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("reports a failed registration instead of swallowing it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockRejectedValue(new Error("script failed"));
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<ServiceWorkerRegistration />);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/service worker/i);
  });

  it("does nothing outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    render(<ServiceWorkerRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
});
