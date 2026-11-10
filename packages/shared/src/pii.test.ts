import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  MAX_SCRUB_DEPTH,
  REDACTED,
  REDACTED_AUTHORIZATION,
  REDACTED_COOKIE,
  REDACTED_PHONE,
  REDACTED_TOKEN,
  REDACTED_VPA,
  scrubText,
  scrubValue,
  TRUNCATED,
} from "./pii.js";

describe("scrubText phones", () => {
  const phoneCases: readonly [string, string][] = [
    ["call +919876543210 now", "call [redacted:phone] now"],
    ["call +91 98765 43210 now", "call [redacted:phone] now"],
    ["call +91-9876543210 now", "call [redacted:phone] now"],
    ["call 0 98765 43210", "call [redacted:phone]"],
    ["call 09876543210 now", "call [redacted:phone] now"],
    ["call 9876543210 now", "call [redacted:phone] now"],
    ["call 98765 43210 now", "call [redacted:phone] now"],
    ["call 98765-43210 now", "call [redacted:phone] now"],
    ["919876543210", "[redacted:phone]"],
    ["+91 84512 30987", "[redacted:phone]"],
    ["multiple: 9876543210 and 8123456780", "multiple: [redacted:phone] and [redacted:phone]"],
    ["landline 01123456789 stays", "landline 01123456789 stays"],
    ["amount 1234567890 stays", "amount 1234567890 stays"],
    ["order 5987654321098 stays", "order 5987654321098 stays"],
  ];

  for (const [input, expected] of phoneCases) {
    it(`redacts ${input}`, () => {
      expect(scrubText(input)).toBe(expected);
    });
  }
});

describe("scrubText VPAs", () => {
  it("redacts standard UPI handles", () => {
    expect(scrubText("paid to shop@paytm")).toBe(`paid to ${REDACTED_VPA}`);
  });

  it("redacts handles with dots and dashes", () => {
    expect(scrubText("vpa a.b-c_name@yenbank")).toBe(`vpa ${REDACTED_VPA}`);
  });

  it("redacts email addresses as contact handles", () => {
    expect(scrubText("mail committee@example.com")).toBe(`mail ${REDACTED_VPA}`);
  });

  it("keeps text without an @ handle", () => {
    expect(scrubText("no handle here")).toBe("no handle here");
  });
});

describe("scrubText tokens and credentials", () => {
  it("redacts bearer tokens", () => {
    expect(scrubText("Authorization: Bearer abc123def456")).toContain(REDACTED_AUTHORIZATION);
  });

  it("redacts basic auth", () => {
    expect(scrubText("Basic dXNlcjpwYXNzd29yZA==")).toContain(REDACTED_AUTHORIZATION);
  });

  it("redacts JWT session tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const scrubbed = scrubText(`session expired for ${jwt}`);
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed).toContain(REDACTED_TOKEN);
  });

  it("redacts cookie headers wholesale", () => {
    const scrubbed = scrubText("Cookie: yen_session=abcdef123456; theme=dark");
    expect(scrubbed).not.toContain("abcdef123456");
    expect(scrubbed).toContain("theme=dark");
  });

  it("keeps non credential values after a cookie header", () => {
    expect(scrubText("Cookie: yen_session=abcdef123456; theme=dark")).toContain(REDACTED_COOKIE);
  });

  it("redacts set-cookie headers", () => {
    expect(scrubText("Set-Cookie: yen_session=abcdef123456")).not.toContain("abcdef123456");
  });

  it("redacts key=value passwords", () => {
    expect(scrubText("password=hunter2")).toBe("password=[redacted]");
    expect(scrubText('PASSWORD: "hunter2"')).toBe("PASSWORD: [redacted]");
    expect(scrubText("password hunter2")).toBe("password [redacted]");
    expect(scrubText("password policy")).toBe("password policy");
  });

  it("redacts JSON style credential keys", () => {
    const input = '{"password":"hunter2","sessionToken":"tok_abc123","phone":"+919876543210"}';
    const scrubbed = scrubText(input);
    expect(scrubbed).not.toContain("hunter2");
    expect(scrubbed).not.toContain("tok_abc123");
    expect(scrubbed).not.toContain("919876543210");
  });

  it("redacts api keys and otps by key", () => {
    expect(scrubText("api_key=sk_live_abcdef")).toBe("api_key=[redacted]");
    expect(scrubText("otp 530912")).toBe("otp [redacted]");
  });

  it("redacts session ids with separators", () => {
    expect(scrubText("session_id: abcdef1234567890")).toBe("session_id: [redacted]");
  });

  it("keeps ordinary numbers that are not credentials", () => {
    expect(scrubText("fund raised 50000 paise in 12 days")).toBe(
      "fund raised 50000 paise in 12 days",
    );
  });

  it("scrubs stack traces without leaking bearer tokens", () => {
    const scrubbed = scrubText("at handler (auth.ts:9) Bearer eyquirkytokenvalue123");
    expect(scrubbed).not.toContain("eyquirkytokenvalue123");
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "Password",
    "sessionToken",
    "refresh_token",
    "authorization",
    "cookie",
    "set-cookie",
    "vpa",
    "phone",
    "phoneNumber",
    "userPhone",
    "approvalPin",
    "otp",
    "email",
    "session",
    "x-api-key",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["fundName", "createdAt", "paise", "expenseId", "route", "status"])(
    "treats %s as safe",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("scrubValue", () => {
  it("returns primitives untouched", () => {
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
    expect(scrubValue(undefined)).toBe(undefined);
  });

  it("scrubs strings", () => {
    expect(scrubValue("call 9876543210")).toBe(`call ${REDACTED_PHONE}`);
  });

  it("redacts values under sensitive keys entirely", () => {
    expect(scrubValue({ password: "hunter2" })).toEqual({ password: REDACTED });
    expect(scrubValue({ sessionToken: "tok_abc" })).toEqual({ sessionToken: REDACTED });
    expect(scrubValue({ vpa: "shop@paytm" })).toEqual({ vpa: REDACTED });
    expect(scrubValue({ cookie: "yen_session=abc" })).toEqual({ cookie: REDACTED });
    expect(scrubValue({ authorization: "Bearer abc123def456" })).toEqual({
      authorization: REDACTED,
    });
  });

  it("scrubs strings nested in objects and arrays", () => {
    const input = {
      attempts: [
        { note: "caller 9876543210", meta: { url: "https://x.test/funds?phone=+919876543210" } },
      ],
    };
    const scrubbed = scrubValue(input) as typeof input;
    expect(JSON.stringify(scrubbed)).not.toContain("919876543210");
  });

  it("scrubs error instances into scrubbed name, message and stack", () => {
    const error = new Error("failed for 9876543210");
    const scrubbed = scrubValue(error) as { name: string; message: string };
    expect(scrubbed.name).toBe("Error");
    expect(scrubbed.message).not.toContain("9876543210");
  });

  it("scrubs Map and Set entries", () => {
    const scrubbed = scrubValue(
      new Map([
        ["phone", "9876543210"],
        ["note", "vpa shop@paytm"],
      ]),
    ) as Record<string, unknown>;
    expect(scrubbed.phone).toBe(REDACTED);
    expect(scrubbed.note).toContain(REDACTED_VPA);
    expect(scrubValue(new Set(["9876543210"]))).toEqual([REDACTED_PHONE]);
  });

  it("converts dates to ISO strings", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(scrubValue(date)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("collapses cycles to [truncated]", () => {
    const cyclic: Record<string, unknown> = { note: "vpa shop@paytm" };
    cyclic.self = cyclic;
    const scrubbed = scrubValue(cyclic) as Record<string, unknown>;
    expect(scrubbed.note).toContain(REDACTED_VPA);
    expect(scrubbed.self).toBe(TRUNCATED);
  });

  it("collapses deep trees beyond the depth limit", () => {
    let node: unknown = { leaf: "9876543210" };
    for (let index = 0; index < MAX_SCRUB_DEPTH + 4; index += 1) {
      node = { child: node };
    }
    let current = scrubValue(node);
    for (let depth = 0; depth < MAX_SCRUB_DEPTH; depth += 1) {
      current = (current as { child: unknown }).child;
    }
    expect(current).toBe(TRUNCATED);
  });

  it("never mutates its input", () => {
    const input = { password: "hunter2", nested: { note: "9876543210" } };
    const snapshot = JSON.stringify(input);
    scrubValue(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does not share redaction state across sibling branches", () => {
    const shared = { note: "vpa shop@paytm" };
    const scrubbed = scrubValue({ a: shared, b: shared }) as { a: unknown; b: unknown };
    expect(scrubbed.a).toEqual(scrubbed.b);
  });
});
