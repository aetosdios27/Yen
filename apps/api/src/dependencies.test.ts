import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { defaultDependencies, validatePinSecret } from "./dependencies.js";

describe("dependencies PIN secret configuration", () => {
  it("rejects weak or short PIN secrets", () => {
    expect(() => validatePinSecret("")).toThrow("PIN_HMAC_SECRET");
    expect(() => validatePinSecret("short-secret")).toThrow("at least 32 characters");
    expect(() => validatePinSecret(12345)).toThrow("PIN_HMAC_SECRET");
    const validSecret = "a".repeat(32);
    expect(validatePinSecret(validSecret)).toBe(validSecret);
  });

  it("does not fall back to a hardcoded secret when PIN_HMAC_SECRET is unset", () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const deps = defaultDependencies();
      expect(deps.pinSecret).toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });

  it("validates and uses explicit PIN_HMAC_SECRET from environment", () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      const explicitSecret = "explicit_test_secret_that_is_32_bytes_long";
      process.env.PIN_HMAC_SECRET = explicitSecret;
      const deps = defaultDependencies();
      expect(deps.pinSecret).toBe(explicitSecret);
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      } else {
        delete process.env.PIN_HMAC_SECRET;
      }
    }
  });

  it("permits non-PIN paths to function normally when PIN is unconfigured", async () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const app = createApp();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ok" });
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });

  it("fails closed on PIN paths when PIN service is unconfigured", async () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const app = createApp({
        principal: { id: "00000000-0000-4000-8000-000000000001" },
      });
      const res = await app.request("/v1/auth/pin/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "setup-unconfigured" },
        body: JSON.stringify({ pin: "482915" }),
      });
      expect(res.status).toBe(403);
      const err = (await res.json()) as { error: { details?: { message: string }[] } };
      expect(err.error.details?.[0]?.message).toContain("unconfigured");
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });
});
