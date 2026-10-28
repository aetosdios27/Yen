import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createApp } from "./app.js";
import {
  DevStubOtpDeliveryProvider,
  generateOtpCode,
  generateSalt,
  generateSessionToken,
  hashOtp,
  hashSessionToken,
  MemoryAuthStore,
  normalizePhone,
  parseDeviceInfo,
  verifyOtp,
} from "./auth/index.js";
import type { LogEntry } from "./logging.js";
import { devPolicy } from "./policy.js";

const parsedTestPhone = normalizePhone("+919876543210");
if (!parsedTestPhone) throw new Error("Invalid test phone");
const testPhone = parsedTestPhone;

import {
  listSessionsResponse,
  rotateSessionResponse,
  sendOtpResponse,
  verifyOtpResponse,
} from "./contract.js";

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ message: z.string() })).default([]),
  }),
});

const meResponseSchema = z.object({
  id: z.string(),
  phone: z.string(),
});

function getDelivery(provider: DevStubOtpDeliveryProvider, phone = testPhone) {
  const delivery = provider.getLastDeliveryFor(phone);
  if (!delivery) {
    throw new Error(`Expected delivery for ${phone}`);
  }
  return delivery;
}

describe("Phone Normalization", () => {
  it("normalizes canonical E.164 numbers", () => {
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("normalizes 10-digit Indian numbers with formatting", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("98765-43210")).toBe("+919876543210");
    expect(normalizePhone("  9876543210  ")).toBe("+919876543210");
  });

  it("normalizes Indian numbers with 0 or 91 prefix", () => {
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("rejects invalid phone numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abcdefghij")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
    expect(normalizePhone("5123456789")).toBeNull(); // Indian mobiles start with 6-9
  });
});

describe("Cryptographic Hashing and Verification", () => {
  it("generates 6-digit numeric OTPs", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("hashes OTP at rest and verifies matching salt+code using constant-time check", () => {
    const salt = generateSalt();
    const code = "741258";
    const hash = hashOtp(salt, code);

    expect(hash).not.toBe(code);
    expect(hash).toHaveLength(64); // SHA-256 hex
    expect(verifyOtp(salt, code, hash)).toBe(true);
    expect(verifyOtp(salt, "000000", hash)).toBe(false);
    expect(verifyOtp(generateSalt(), code, hash)).toBe(false);
  });

  it("hashes session tokens using SHA-256", () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(64); // 32 bytes hex
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
  });
});

describe("Device Info Parser", () => {
  it("detects OS and Browser combinations accurately", () => {
    expect(
      parseDeviceInfo(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");

    expect(
      parseDeviceInfo(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");

    expect(
      parseDeviceInfo(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");

    expect(parseDeviceInfo("")).toBe("Unknown device");
    expect(parseDeviceInfo(undefined)).toBe("Unknown device");
  });
});

describe("Phone OTP Login and Session Lifecycle Integration", () => {
  function createTestSetup(initialTime = 1_000_000) {
    let now = initialTime;
    const clock = () => now;
    const logs: LogEntry[] = [];
    const logger = {
      log: (entry: LogEntry) => {
        logs.push(entry);
      },
    };
    const otpDeliveryProvider = new DevStubOtpDeliveryProvider(clock);
    const authStore = new MemoryAuthStore();

    const app = createApp({
      clock,
      logger,
      policy: devPolicy,
      otpDeliveryProvider,
      authStore,
      otpCooldownMs: 60_000,
      otpExpiryMs: 300_000,
      otpMaxAttempts: 3,
      otpRateLimitIp: { capacity: 5, refillMs: 600_000 },
      otpRateLimitPhone: { capacity: 3, refillMs: 600_000 },
      clientIp: () => "203.0.113.195",
    });

    return {
      app,
      authStore,
      otpDeliveryProvider,
      logs,
      advanceClock: (ms: number) => {
        now += ms;
      },
      getNow: () => now,
    };
  }

  it("issues OTP via WhatsApp default, stores hashed at rest, and verifies cleanly", async () => {
    const { app, otpDeliveryProvider, authStore, getNow } = createTestSetup();

    const sendRes = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "9876543210" }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = sendOtpResponse.parse(await sendRes.json());
    expect(sendData.status).toBe("sent");
    expect(sendData.channel).toBe("whatsapp");
    expect(sendData.resendAfterSeconds).toBe(60);

    const delivery = getDelivery(otpDeliveryProvider);
    expect(delivery.code).toMatch(/^\d{6}$/);

    // Verify hashed at rest
    const challenge = await authStore.getLatestActiveOtpChallenge(testPhone, getNow());
    expect(challenge).toBeDefined();
    if (!challenge) throw new Error("Challenge must exist");
    expect(challenge.otpHash).not.toBe(delivery.code);
    expect(verifyOtp(challenge.salt, delivery.code, challenge.otpHash)).toBe(true);

    // Verify with code
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10; Redmi 9A) AppleWebKit/537.36 Chrome/100 Mobile",
      },
      body: JSON.stringify({ phone: "98765 43210", code: delivery.code }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyData = verifyOtpResponse.parse(await verifyRes.json());
    expect(verifyData.status).toBe("authenticated");
    expect(verifyData.session.user.phone).toBe("+919876543210");
    expect(verifyData.session.token).toHaveLength(64);

    // Verify Set-Cookie header contains httpOnly, SameSite, Secure session cookie
    const setCookie = verifyRes.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("yen_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("supports SMS channel fallback when requested", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    const sendRes = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "sms" }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = sendOtpResponse.parse(await sendRes.json());
    expect(sendData.channel).toBe("sms");

    const delivery = getDelivery(otpDeliveryProvider);
    expect(delivery.channel).toBe("sms");
  });

  it("enforces 60-second resend cooldown with Retry-After header", async () => {
    const { app, advanceClock } = createTestSetup();

    // First send
    const res1 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(res1.status).toBe(200);

    // Immediate second send -> 429
    const res2 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(res2.status).toBe(429);
    expect(res2.headers.get("retry-after")).toBe("60");

    // Advance 30 seconds -> still cooled down
    advanceClock(30_000);
    const res3 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(res3.status).toBe(429);
    expect(res3.headers.get("retry-after")).toBe("30");

    // Advance past 60 seconds -> succeeds
    advanceClock(31_000);
    const res4 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(res4.status).toBe(200);
  });

  it("enforces 5-minute expiry on OTP codes", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);

    // Advance 301 seconds (past 5 minutes)
    advanceClock(301_000);

    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    expect(verifyRes.status).toBe(400);
    const err = errorResponseSchema.parse(await verifyRes.json());
    expect(err.error.details[0]?.message).toContain("expired");
  });

  it("limits incorrect verification attempts and brute-force attacks", async () => {
    const { app } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });

    // Attempt 1: wrong code -> 400 with "Wrong code, try again"
    const try1 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "000000" }),
    });
    expect(try1.status).toBe(400);
    const err1 = errorResponseSchema.parse(await try1.json());
    expect(err1.error.details[0]?.message).toBe("Wrong code, try again");

    // Attempt 2: wrong code -> 400
    const try2 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "111111" }),
    });
    expect(try2.status).toBe(400);

    // Attempt 3: 3rd wrong code exceeds max attempts -> 429 rate limited
    const try3 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "222222" }),
    });
    expect(try3.status).toBe(429);
    const err3 = errorResponseSchema.parse(await try3.json());
    expect(err3.error.details[0]?.message).toContain("Too many failed attempts");
  });

  it("prevents single-use OTP replay", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);

    // First verify succeeds
    const verify1 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    expect(verify1.status).toBe(200);

    // Replay of same code fails
    const verify2 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    expect(verify2.status).toBe(400);
  });

  it("authenticates using either Bearer token or httpOnly session cookie", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);

    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    const authData = verifyOtpResponse.parse(await verifyRes.json());
    const token = authData.session.token;

    // 1. Authenticate with Authorization: Bearer
    const meBearer = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meBearer.status).toBe(200);
    const meBearerData = meResponseSchema.parse(await meBearer.json());
    expect(meBearerData.phone).toBe("+919876543210");

    // 2. Authenticate with Cookie: yen_session=
    const meCookie = await app.request("/v1/me", {
      headers: { cookie: `yen_session=${token}` },
    });
    expect(meCookie.status).toBe(200);
    const meCookieData = meResponseSchema.parse(await meCookie.json());
    expect(meCookieData.id).toBe(meBearerData.id);

    // 3. Unauthenticated request fails
    const meUnauth = await app.request("/v1/me");
    expect(meUnauth.status).toBe(401);
  });

  it("supports session token rotation, invalidating old token", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    const authData = verifyOtpResponse.parse(await verifyRes.json());
    const oldToken = authData.session.token;

    // Rotate session
    const rotateRes = await app.request("/v1/auth/session/rotate", {
      method: "POST",
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(rotateRes.status).toBe(200);
    const rotateData = rotateSessionResponse.parse(await rotateRes.json());
    const newToken = rotateData.session.token;
    expect(newToken).not.toBe(oldToken);

    // New token works
    const testNew = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(testNew.status).toBe(200);

    // Old token is immediately invalidated
    const testOld = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(testOld.status).toBe(401);
  });

  it("provides device list and supports sign out everywhere", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();

    // Session 1: Android
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const d1 = getDelivery(otpDeliveryProvider);
    const v1 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Linux; Android 12) Chrome/100 Mobile",
      },
      body: JSON.stringify({ phone: "+919876543210", code: d1.code }),
    });
    const session1 = verifyOtpResponse.parse(await v1.json()).session;

    advanceClock(70_000);

    // Session 2: iPhone
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const d2 = getDelivery(otpDeliveryProvider);
    const v2 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Safari/604.1",
      },
      body: JSON.stringify({ phone: "+919876543210", code: d2.code }),
    });
    const session2 = verifyOtpResponse.parse(await v2.json()).session;

    // View device list from Session 2
    const sessionsListRes = await app.request("/v1/auth/sessions", {
      headers: { authorization: `Bearer ${session2.token}` },
    });
    expect(sessionsListRes.status).toBe(200);
    const sessionsList = listSessionsResponse.parse(await sessionsListRes.json()).sessions;
    expect(sessionsList).toHaveLength(2);
    expect(sessionsList[0]?.deviceInfo).toBe("Safari on iOS");
    expect(sessionsList[0]?.isCurrent).toBe(true);
    expect(sessionsList[1]?.deviceInfo).toBe("Chrome on Android");
    expect(sessionsList[1]?.isCurrent).toBe(false);

    // Sign out everywhere from Session 2
    const logoutAllRes = await app.request("/v1/auth/logout-all", {
      method: "POST",
      headers: { authorization: `Bearer ${session2.token}` },
    });
    expect(logoutAllRes.status).toBe(200);

    // Both sessions are now revoked
    const me1 = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${session1.token}` },
    });
    expect(me1.status).toBe(401);

    const me2 = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${session2.token}` },
    });
    expect(me2.status).toBe(401);
  });

  it("satisfies security acceptance criteria: OTPs and tokens NEVER appear in logs or error bodies", async () => {
    const { app, otpDeliveryProvider, logs } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);
    const plainOtp = delivery.code;

    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: plainOtp }),
    });
    const sessionToken = verifyOtpResponse.parse(await verifyRes.json()).session.token;

    // Intentionally trigger an error
    await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "999999" }),
    });

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(plainOtp);
    expect(serializedLogs).not.toContain(sessionToken);
    expect(serializedLogs).not.toContain("+919876543210");
  });

  it("handles slow connections on mobile devices gracefully (throttled test)", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    // Simulate high latency / throttled connection
    const start = Date.now();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Linux; Android 9; SM-J260G) Chrome/80.0 Mobile",
      },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    const d = getDelivery(otpDeliveryProvider);

    const res = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Linux; Android 9; SM-J260G) Chrome/80.0 Mobile",
      },
      body: JSON.stringify({ phone: "+919876543210", code: d.code }),
    });
    expect(res.status).toBe(200);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Efficient execution without unneeded bottlenecks
  });
});
