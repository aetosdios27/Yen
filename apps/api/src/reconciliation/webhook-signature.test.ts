import { describe, expect, it } from "vitest";
import {
  PARTNER_TIMESTAMP_TOLERANCE_MS,
  signPartnerWebhook,
  verifyPartnerWebhook,
} from "./webhook-signature.js";

const secret = "unit-test-partner-webhook-secret-32-chars";
const nowMs = Date.UTC(2026, 9, 28, 12, 0, 0);
const timestamp = String(nowMs / 1000);
const body = new TextEncoder().encode('{"event":"virtual_account.credited"}');

function verify(overrides: Partial<Parameters<typeof verifyPartnerWebhook>[0]> = {}) {
  return verifyPartnerWebhook({
    secret,
    signature: signPartnerWebhook(secret, timestamp, body),
    timestamp,
    rawBody: body,
    nowMs,
    ...overrides,
  });
}

describe("partner webhook signature", () => {
  it("matches the documented HMAC-SHA256 over v1.<timestamp>.<raw body>", () => {
    expect(signPartnerWebhook("key", "1", new TextEncoder().encode("{}"))).toBe(
      "cf4ef1f6b657f56beaf59fcaaff7c71bf73121c5b74f4b0e1bca101b038dd5b0",
    );
  });

  it("accepts a correctly signed request inside the tolerance on both sides", () => {
    expect(verify()).toBe(true);
    for (const offset of [-PARTNER_TIMESTAMP_TOLERANCE_MS, PARTNER_TIMESTAMP_TOLERANCE_MS]) {
      expect(verify({ nowMs: nowMs + offset })).toBe(true);
    }
  });

  it("rejects stale and future timestamps beyond the tolerance", () => {
    expect(verify({ nowMs: nowMs + PARTNER_TIMESTAMP_TOLERANCE_MS + 1 })).toBe(false);
    expect(verify({ nowMs: nowMs - PARTNER_TIMESTAMP_TOLERANCE_MS - 1 })).toBe(false);
  });

  it("binds the timestamp and the exact bytes to the signature", () => {
    expect(verify({ timestamp: String(Number(timestamp) + 1) })).toBe(false);
    expect(
      verify({ rawBody: new TextEncoder().encode('{"event": "virtual_account.credited"}') }),
    ).toBe(false);
    expect(verify({ signature: signPartnerWebhook(secret, "1", body) })).toBe(false);
    expect(verify({ signature: signPartnerWebhook(`${secret}x`, timestamp, body) })).toBe(false);
  });

  it("fails closed for missing configuration and malformed credentials", () => {
    expect(verify({ secret: null })).toBe(false);
    expect(verify({ secret: "" })).toBe(false);
    expect(verify({ signature: undefined })).toBe(false);
    expect(verify({ timestamp: undefined })).toBe(false);
    const signature = signPartnerWebhook(secret, timestamp, body);
    for (const malformed of [
      signature.toUpperCase(),
      signature.slice(1),
      `${signature}0`,
      `sha256=${signature}`,
      ` ${signature}`,
      "",
    ]) {
      expect(verify({ signature: malformed })).toBe(false);
    }
    for (const malformed of ["", "abc", `0${timestamp}`, `${timestamp}.0`, `+${timestamp}`, "-1"]) {
      expect(
        verify({
          timestamp: malformed,
          signature: signPartnerWebhook(secret, malformed, body),
        }),
      ).toBe(false);
    }
  });
});
