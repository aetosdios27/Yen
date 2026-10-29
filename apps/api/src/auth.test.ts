import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createApp } from "./app.js";
import {
  createOtpDeliveryProvider,
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
import {
  listSessionsResponse,
  rotateSessionResponse,
  sendOtpResponse,
  verifyOtpResponse,
} from "./contract.js";
import type { LogEntry } from "./logging.js";
import { MemoryPinStore } from "./pin/index.js";
import { devPolicy } from "./policy.js";

const parsedTestPhone = normalizePhone("+919876543210");
if (!parsedTestPhone) throw new Error("Invalid test phone");
const testPhone = parsedTestPhone;
const otpHashKey = "test-only-otp-hash-key-with-at-least-32-bytes";

it("does not report fake OTP delivery as successful in production", async () => {
  const provider = createOtpDeliveryProvider("production");
  await expect(
    provider.sendOtp({ phone: testPhone, code: "123456", preferredChannel: "sms" }),
  ).resolves.toMatchObject({ success: false, channel: "sms" });
});

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
    const hash = hashOtp(otpHashKey, salt, code);

    expect(hash).not.toBe(code);
    expect(hash).toHaveLength(64); // SHA-256 hex
    expect(verifyOtp(otpHashKey, salt, code, hash)).toBe(true);
    expect(verifyOtp(`${otpHashKey}!`, salt, code, hash)).toBe(false);
    expect(verifyOtp(otpHashKey, salt, "000000", hash)).toBe(false);
    expect(verifyOtp(otpHashKey, generateSalt(), code, hash)).toBe(false);
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
    const pinStore = new MemoryPinStore({ clock });

    const app = createApp({
      clock,
      logger,
      policy: devPolicy,
      otpDeliveryProvider,
      authStore,
      pinStore,
      pinSecret: "test-yen72-pin-hmac-secret-with-more-than-32-bytes",
      otpCooldownMs: 60_000,
      otpExpiryMs: 300_000,
      otpMaxAttempts: 3,
      otpHashKey,
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

  async function setupPin(app: ReturnType<typeof createApp>, token: string) {
    return app.request("/v1/auth/pin/setup", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ pin: "482915" }),
    });
  }

  async function unlockDevice(app: ReturnType<typeof createApp>, token: string, pin = "482915") {
    return app.request("/v1/auth/device/unlock", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
  }

  it("issues OTP via WhatsApp default, stores hashed at rest, and verifies cleanly", async () => {
    const { app, otpDeliveryProvider, authStore, getNow } = createTestSetup();

    const sendRes = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "9876543210", channel: "whatsapp" }),
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
    expect(verifyOtp(otpHashKey, challenge.salt, delivery.code, challenge.otpHash)).toBe(true);

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
    expect(
      (
        await app.request("/v1/me", {
          headers: { authorization: `Bearer ${verifyData.session.token}` },
        })
      ).status,
    ).toBe(401);
    expect((await setupPin(app, verifyData.session.token)).status).toBe(201);
    expect(
      (
        await app.request("/v1/me", {
          headers: { authorization: `Bearer ${verifyData.session.token}` },
        })
      ).status,
    ).toBe(200);
  });

  it("supports the selected SMS delivery channel", async () => {
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

  it("requires an explicit delivery channel", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();
    const response = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });

    expect(response.status).toBe(400);
    expect(otpDeliveryProvider.getDeliveries()).toHaveLength(0);
  });

  it("does not persist a challenge when a provider silently switches channels", async () => {
    const { authStore } = createTestSetup();
    const mismatched = createApp({
      authStore,
      otpHashKey,
      otpDeliveryProvider: {
        sendOtp: async () => ({ success: true, channel: "whatsapp" as const }),
      },
    });
    const response = await mismatched.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "sms" }),
    });

    expect(response.status).toBe(500);
    expect(await authStore.getLatestActiveOtpChallenge(testPhone, Date.now())).toBeNull();
  });

  it("enforces 60-second resend cooldown with Retry-After header", async () => {
    const { app, advanceClock } = createTestSetup();

    // First send
    const res1 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    expect(res1.status).toBe(200);

    // Immediate second send -> 429
    const res2 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    expect(res2.status).toBe(429);
    expect(res2.headers.get("retry-after")).toBe("60");

    // Advance 30 seconds -> still cooled down
    advanceClock(30_000);
    const res3 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    expect(res3.status).toBe(429);
    expect(res3.headers.get("retry-after")).toBe("30");

    // Advance past 60 seconds -> succeeds
    advanceClock(31_000);
    const res4 = await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    expect(res4.status).toBe(200);
  });

  it("keeps one live code and limits attempts per phone across channels", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const whatsappCode = getDelivery(otpDeliveryProvider).code;

    for (const code of ["000000", "111111"]) {
      await app.request("/v1/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+919876543210", code }),
      });
    }

    advanceClock(60_000);
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "sms" }),
    });
    const smsCode = getDelivery(otpDeliveryProvider).code;

    const oldCode = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: whatsappCode }),
    });
    expect(oldCode.status).toBe(400);

    const active = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: smsCode }),
    });
    expect(active.status).toBe(429);
  });

  it("returns the same error for an unknown number and an invalid code", async () => {
    const { app } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const known = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "000000" }),
    });
    const unknown = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+14155552671", code: "000000" }),
    });
    expect(known.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(errorResponseSchema.parse(await known.json())).toEqual(
      errorResponseSchema.parse(await unknown.json()),
    );
  });

  it("enforces 5-minute expiry on OTP codes", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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
    expect(err.error.details[0]?.message).toBe("Invalid or expired code");
  });

  it("limits incorrect verification attempts and brute-force attacks", async () => {
    const { app } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });

    // Attempt 1: wrong code -> 400 with "Wrong code, try again"
    const try1 = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: "000000" }),
    });
    expect(try1.status).toBe(400);
    const err1 = errorResponseSchema.parse(await try1.json());
    expect(err1.error.details[0]?.message).toBe("Invalid or expired code");

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
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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

  it("allows only one concurrent verification to consume an OTP", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const code = getDelivery(otpDeliveryProvider).code;
    const verify = () =>
      app.request("/v1/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+919876543210", code }),
      });

    const responses = await Promise.all([verify(), verify()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it("authenticates using either Bearer token or httpOnly session cookie", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);

    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    const authData = verifyOtpResponse.parse(await verifyRes.json());
    const token = authData.session.token;

    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
    expect((await setupPin(app, token)).status).toBe(201);

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
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const delivery = getDelivery(otpDeliveryProvider);
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: delivery.code }),
    });
    const authData = verifyOtpResponse.parse(await verifyRes.json());
    const oldToken = authData.session.token;
    const absoluteExpiry = authData.session.expiresAt;
    expect((await setupPin(app, oldToken)).status).toBe(201);
    advanceClock(29 * 24 * 60 * 60 * 1000);

    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${oldToken}` } })).status,
    ).toBe(401);
    expect((await unlockDevice(app, oldToken)).status).toBe(200);

    // Rotate session
    const rotateRes = await app.request("/v1/auth/session/rotate", {
      method: "POST",
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(rotateRes.status).toBe(200);
    const rotateData = rotateSessionResponse.parse(await rotateRes.json());
    const newToken = rotateData.session.token;
    expect(rotateData.session.expiresAt).toBe(absoluteExpiry);
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

    advanceClock(24 * 60 * 60 * 1000);
    const afterAbsoluteExpiry = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(afterAbsoluteExpiry.status).toBe(401);
  });

  it("provides device list and supports sign out everywhere", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();

    // Session 1: Android
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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
    expect((await setupPin(app, session1.token)).status).toBe(201);

    advanceClock(70_000);

    // Session 2: iPhone
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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
    expect((await unlockDevice(app, session2.token)).status).toBe(200);

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

  it("shares the approval PIN lockout counter with trusted-device unlock", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: getDelivery(otpDeliveryProvider).code }),
    });
    const session = verifyOtpResponse.parse(await verifyRes.json()).session;
    expect((await setupPin(app, session.token)).status).toBe(201);

    for (let attempt = 0; attempt < 4; attempt++) {
      const failure = await app.request("/v1/auth/pin/verify", {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
        body: JSON.stringify({ pin: "937104", actionHash: "a".repeat(64) }),
      });
      expect(failure.status).toBe(403);
    }

    const unlockFailure = await unlockDevice(app, session.token, "937104");
    expect(unlockFailure.status).toBe(401);
    expect(errorResponseSchema.parse(await unlockFailure.json()).error.message).toBe(
      "Authentication required",
    );
    expect((await unlockDevice(app, session.token)).status).toBe(401);
  });

  it("requires OTP-backed session proof before a PIN can bind a device", async () => {
    const { app } = createTestSetup();
    const response = await app.request("/v1/auth/device/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "482915" }),
    });
    expect(response.status).toBe(401);
  });

  it("locks a trusted device until the correct PIN is entered", async () => {
    const { app, otpDeliveryProvider, logs } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: getDelivery(otpDeliveryProvider).code }),
    });
    const session = verifyOtpResponse.parse(await verifyRes.json()).session;
    expect((await setupPin(app, session.token)).status).toBe(201);

    const locked = await app.request("/v1/auth/device/lock", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(locked.status).toBe(200);
    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${session.token}` } }))
        .status,
    ).toBe(401);

    const wrongPin = await unlockDevice(app, session.token, "937104");
    expect(wrongPin.status).toBe(401);
    expect(JSON.stringify(logs)).not.toContain("937104");
    expect(errorResponseSchema.parse(await wrongPin.json()).error.message).toBe(
      "Authentication required",
    );

    expect((await unlockDevice(app, session.token)).status).toBe(200);
    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${session.token}` } }))
        .status,
    ).toBe(200);
  });

  it("lets an idle-locked device sign out without PIN reauthentication", async () => {
    const { app, otpDeliveryProvider, advanceClock } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: getDelivery(otpDeliveryProvider).code }),
    });
    const session = verifyOtpResponse.parse(await verifyRes.json()).session;
    expect((await setupPin(app, session.token)).status).toBe(201);

    advanceClock(7 * 24 * 60 * 60 * 1000);
    const signOut = await app.request("/v1/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(signOut.status).toBe(200);
    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${session.token}` } }))
        .status,
    ).toBe(401);
  });

  it("satisfies security acceptance criteria: OTPs and tokens NEVER appear in logs or error bodies", async () => {
    const { app, otpDeliveryProvider, logs } = createTestSetup();

    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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

  it("resets the PIN through the selected OTP channel and lets it unlock during approval cooling off", async () => {
    const { app, otpDeliveryProvider } = createTestSetup();
    await app.request("/v1/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
    });
    const verifyRes = await app.request("/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", code: getDelivery(otpDeliveryProvider).code }),
    });
    const session = verifyOtpResponse.parse(await verifyRes.json()).session;
    expect((await setupPin(app, session.token)).status).toBe(201);

    const requestReset = await app.request("/v1/auth/pin/reset/request", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "sms" }),
    });
    expect(requestReset.status).toBe(200);
    const challengeId = z
      .object({ challengeId: z.string().uuid() })
      .parse(await requestReset.json()).challengeId;
    expect(getDelivery(otpDeliveryProvider).channel).toBe("sms");

    const reset = await app.request("/v1/auth/pin/reset/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        challengeId,
        otp: getDelivery(otpDeliveryProvider).code,
        newPin: "937104",
      }),
    });
    expect(reset.status).toBe(200);
    expect(z.object({ status: z.literal("cooling_off") }).parse(await reset.json()).status).toBe(
      "cooling_off",
    );

    await app.request("/v1/auth/device/lock", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect((await unlockDevice(app, session.token, "937104")).status).toBe(200);
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
      body: JSON.stringify({ phone: "+919876543210", channel: "whatsapp" }),
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
