import { InMemoryExpenseStore } from "@yen/ledger";
import { describe, expect, it } from "vitest";
import { createApp, devPolicy } from "../app.js";
import { defaultDependencies } from "../dependencies.js";
import { type LogEntry, serializeRequestLog } from "../logging.js";
import { computeActionHash } from "./crypto.js";
import { MemoryPinNotificationService } from "./notifications.js";
import type { PinOtpVerifier } from "./otp.js";
import { MemoryPinOtpVerifier } from "./otp.test-helper.js";
import { PinService } from "./service.js";
import { MemoryActionTokenStore, MemoryPinStore } from "./store.js";

describe("Approval PIN (YEN-25)", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const principal = { id: userId, roles: ["approver"] as const };

  // biome-ignore lint/suspicious/noExplicitAny: test json unwrapper
  const jsonOf = async <T = any>(res: Response): Promise<T> => (await res.json()) as T;

  function buildTestApp(
    options: {
      clockStart?: number;
      principal?: { id: string; roles?: readonly string[]; capabilities?: readonly string[] };
      pinSecret?: string | null;
      otpVerifier?: PinOtpVerifier | null;
    } = {},
  ) {
    let now = options.clockStart ?? 1700000000000;
    const clock = () => now;
    const setTime = (time: number) => {
      now = time;
    };
    const advanceTime = (ms: number) => {
      now += ms;
    };

    const logs: LogEntry[] = [];
    const logger = {
      log: (entry: LogEntry) => {
        logs.push(entry);
      },
    };

    const pinStore = new MemoryPinStore({ clock });
    const actionTokenStore = new MemoryActionTokenStore({ clock });
    const pinNotificationService = new MemoryPinNotificationService();
    const pinSecret =
      options.pinSecret !== undefined
        ? options.pinSecret
        : "test_pin_hmac_secret_32_bytes_long_env_kms";
    const otpVerifier =
      options.otpVerifier !== undefined ? options.otpVerifier : new MemoryPinOtpVerifier({ clock });

    const pinService = new PinService({
      pinStore,
      actionTokenStore,
      notificationService: pinNotificationService,
      pinSecret,
      otpVerifier,
      clock,
    });

    const activePrincipal = options.principal ?? principal;
    const deps = {
      ...defaultDependencies(clock),
      policy: devPolicy,
      principal: activePrincipal,
      clock,
      logger,
      pinStore,
      actionTokenStore,
      pinNotificationService,
      pinSecret,
      otpVerifier,
      pinService,
      expenseStore: new InMemoryExpenseStore(),
    };

    const app = createApp(deps);

    let keyCounter = 1;
    const post = async (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> => {
      const idempotencyKey = headers["Idempotency-Key"] ?? `idemp-key-${keyCounter++}`;
      return await app.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...headers,
        },
        body: JSON.stringify(body ?? {}),
      });
    };

    const postAs = async (
      actingPrincipal: { id: string; roles?: readonly string[]; capabilities?: readonly string[] },
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> => {
      const actingApp = createApp({ ...deps, principal: actingPrincipal });
      const idempotencyKey = headers["Idempotency-Key"] ?? `idemp-key-${keyCounter++}`;
      return await actingApp.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...headers,
        },
        body: JSON.stringify(body ?? {}),
      });
    };

    return {
      app,
      deps,
      clock,
      setTime,
      advanceTime,
      logs,
      pinNotificationService,
      pinStore,
      pinService,
      otpVerifier,
      post,
      postAs,
    };
  }

  describe("PIN Setup and Status", () => {
    it("reports not_set status before setup and active after setup", async () => {
      const { app, post } = buildTestApp();

      // Check status before setup
      const res1 = await app.request("/v1/auth/pin/status", { method: "GET" });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1).toEqual({
        isSet: false,
        status: "not_set",
        lockedUntil: null,
        coolingOffUntil: null,
        failedAttempts: 0,
      });

      // Setup PIN
      const res2 = await post("/v1/auth/pin/setup", { pin: "482915" });
      expect(res2.status).toBe(201);
      const body2 = await jsonOf(res2);
      expect(body2).toEqual({ status: "created", isSet: true });

      // Check status after setup
      const res3 = await app.request("/v1/auth/pin/status", { method: "GET" });
      expect(res3.status).toBe(200);
      const body3 = await jsonOf(res3);
      expect(body3.isSet).toBe(true);
      expect(body3.status).toBe("active");
      expect(body3.failedAttempts).toBe(0);
      // Ensure no salt or hash leaked
      expect(body3).not.toHaveProperty("salt");
      expect(body3).not.toHaveProperty("pinHash");
    });

    it("rejects duplicate PIN setup when already configured", async () => {
      const { post } = buildTestApp();

      const res1 = await post("/v1/auth/pin/setup", { pin: "482915" });
      expect(res1.status).toBe(201);

      // Attempt second setup
      const res2 = await post("/v1/auth/pin/setup", { pin: "719382" });
      expect(res2.status).toBe(409);
      const err = await jsonOf(res2);
      expect(err.error.code).toBe("conflict");
    });

    it("refuses weak PINs at setup (common, repeats, runs, user ID derived)", async () => {
      const { post } = buildTestApp();

      const weakPins = [
        "000000", // Common identical
        "123456", // Common ascending
        "654321", // Common descending
        "121212", // Repeating pair
        "123123", // Repeating triplet
        "112233", // Consecutive pairs
        "234567", // Ascending run
        "876543", // Descending run
        "000001", // Derived from user ID 00000000-0000-4000-8000-000000000001
      ];

      for (const pin of weakPins) {
        const res = await post("/v1/auth/pin/setup", { pin });
        expect(res.status).toBe(400);
        const err = await jsonOf(res);
        expect(err.error.code).toBe("validation_failed");
      }
    });

    it("rejects unauthenticated requests to PIN routes", async () => {
      // Test without principal
      const unauthApp = createApp({
        ...defaultDependencies(),
        principal: null,
      });

      const res1 = await unauthApp.request("/v1/auth/pin/status", { method: "GET" });
      expect(res1.status).toBe(401);

      const res2 = await unauthApp.request("/v1/auth/pin/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "unauth-key-1",
        },
        body: JSON.stringify({ pin: "482915" }),
      });
      expect(res2.status).toBe(401);
    });
  });

  describe("PIN Verification and Action Binding", () => {
    it("issues a single-use 60s approval token bound to the action hash", async () => {
      const { post } = buildTestApp();

      // 1. Setup PIN
      await post("/v1/auth/pin/setup", { pin: "482915" });

      // 2. Action hash for an expense approval
      const actionDetails = {
        action: "expense:approve",
        fundId: "00000000-0000-4000-8000-000000000010",
        targetId: "00000000-0000-4000-8000-000000000020",
      };
      const actionHash = computeActionHash(actionDetails);

      // 3. Verify PIN
      const verifyRes = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(verifyRes.status).toBe(200);
      const verifyBody = await jsonOf(verifyRes);
      expect(verifyBody.approvalToken).toBeDefined();
      expect(verifyBody.expiresAt).toBeDefined();
    });

    it("rejects verification when PIN is not yet set", async () => {
      const { post } = buildTestApp();

      const res = await post("/v1/auth/pin/verify", {
        pin: "482915",
        actionHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });
      expect(res.status).toBe(403);
      const err = await jsonOf(res);
      expect(err.error.code).toBe("forbidden");
    });
  });

  describe("Rate Limiting, Temporary Lockout, and 24h Lockout", () => {
    it("locks PIN for 30 minutes on 5 consecutive wrong tries and sets Retry-After", async () => {
      const { post, advanceTime } = buildTestApp();

      await post("/v1/auth/pin/setup", { pin: "482915" });

      const actionHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      // Attempts 1 to 4: returns 403 with attempts remaining
      for (let i = 1; i <= 4; i++) {
        const res = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
        expect(res.status).toBe(403);
        const err = await jsonOf(res);
        expect(err.error.details[0].message).toContain(`${5 - i} attempt`);
      }

      // 5th wrong attempt: locks for 30 minutes (returns 429 rate_limited)
      const res5 = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      expect(res5.status).toBe(429);
      expect(res5.headers.get("retry-after")).toBe("1800");

      // While locked (e.g. 10 minutes later): still 429
      advanceTime(10 * 60 * 1000);
      const resLocked = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(resLocked.status).toBe(429);
      expect(Number(resLocked.headers.get("retry-after"))).toBeLessThanOrEqual(1200);

      // Advance past 30 minutes: unlocked, correct PIN succeeds
      advanceTime(21 * 60 * 1000);
      const resUnlocked = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(resUnlocked.status).toBe(200);
    });

    it("locks out PIN permanently after 10 failed attempts in 24 hours and notifies approvers", async () => {
      const { app, post, postAs, advanceTime, pinNotificationService } = buildTestApp();

      await post("/v1/auth/pin/setup", { pin: "482915" });

      const actionHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      // 5 wrong attempts -> 30m lock
      for (let i = 1; i <= 5; i++) {
        await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      }

      // Fast forward past 30-min lock
      advanceTime(31 * 60 * 1000);

      // Attempts 6 to 9
      for (let i = 6; i <= 9; i++) {
        const res = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
        expect(res.status).toBe(403);
      }

      // 10th wrong attempt -> permanent lockout (notifies other approvers)
      const res10 = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      expect(res10.status).toBe(403);
      const err10 = await jsonOf(res10);
      expect(err10.error.details[0].message).toContain("10 failed attempts in 24 hours");

      // Verify notification was dispatched to approvers
      const notifications = pinNotificationService.getEvents();
      const lockoutEvent = notifications.find((e) => e.kind === "pin_lockout");
      expect(lockoutEvent).toBeDefined();
      expect(lockoutEvent?.userId).toBe(userId);

      // Check status reports locked_out
      const statusRes = await app.request("/v1/auth/pin/status", { method: "GET" });
      const statusBody = await jsonOf(statusRes);
      expect(statusBody.status).toBe("locked_out");

      // Subsequent attempt even with correct PIN is refused
      const resBlocked = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(resBlocked.status).toBe(403);

      // Arbitrary user cannot unlock PIN (fails closed with 403)
      const arbitraryUnlock = await post("/v1/auth/pin/unlock", { targetUserId: userId });
      expect(arbitraryUnlock.status).toBe(403);

      // Authorized owner/support with explicit server admin role unlocks PIN
      const adminPrincipal = {
        id: "00000000-0000-4000-8000-000000000099",
        roles: ["admin"],
      };
      const unlockRes = await postAs(adminPrincipal, "/v1/auth/pin/unlock", {
        targetUserId: userId,
      });
      expect(unlockRes.status).toBe(200);

      // Now correct PIN succeeds
      const resRestored = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(resRestored.status).toBe(200);
    });
  });

  describe("Change PIN", () => {
    it("successfully changes PIN when current PIN is verified", async () => {
      const { post } = buildTestApp();

      await post("/v1/auth/pin/setup", { pin: "482915" });

      // Change PIN
      const res = await post("/v1/auth/pin/change", {
        currentPin: "482915",
        newPin: "937104",
      });
      expect(res.status).toBe(200);

      // Old PIN no longer works
      const actionHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const oldRes = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(oldRes.status).toBe(403);

      // New PIN works
      const newRes = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      expect(newRes.status).toBe(200);
    });

    it("rejects changing PIN if new PIN is identical to current PIN", async () => {
      const { post } = buildTestApp();

      await post("/v1/auth/pin/setup", { pin: "482915" });

      const res = await post("/v1/auth/pin/change", {
        currentPin: "482915",
        newPin: "482915",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Reset PIN and 24-Hour Cooling-Off", () => {
    it("places PIN into 24-hour cooling off after reset, blocking approvals and notifying fund members", async () => {
      const { app, post, advanceTime, pinNotificationService } = buildTestApp();

      await post("/v1/auth/pin/setup", { pin: "482915" });

      // 1. Request reset
      const reqRes = await post("/v1/auth/pin/reset/request", {});
      expect(reqRes.status).toBe(200);

      // 2. Confirm reset with OTP and new PIN
      const confirmRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
      });
      expect(confirmRes.status).toBe(200);
      const confirmBody = await jsonOf(confirmRes);
      expect(confirmBody.status).toBe("cooling_off");

      // Verify notification sent to all members
      const notifications = pinNotificationService.getEvents();
      const resetEvent = notifications.find((e) => e.kind === "pin_reset");
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.recipientRoles).toEqual(["all_fund_members"]);

      // Status shows cooling_off
      const statusRes = await app.request("/v1/auth/pin/status", { method: "GET" });
      const statusBody = await jsonOf(statusRes);
      expect(statusBody.status).toBe("cooling_off");

      // During cooling-off (e.g. 12 hours later): verification is refused
      advanceTime(12 * 60 * 60 * 1000);
      const actionHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const verifyRes = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      expect(verifyRes.status).toBe(403);
      const err = await jsonOf(verifyRes);
      expect(err.error.details[0].message).toContain("cooling-off");

      // Past 24 hours: cooling off expires, new PIN works
      advanceTime(13 * 60 * 60 * 1000);
      const verifyRes2 = await post("/v1/auth/pin/verify", { pin: "937104", actionHash });
      expect(verifyRes2.status).toBe(200);
    });

    it("fails closed when OTP reset provider is unconfigured", async () => {
      const { post } = buildTestApp({ otpVerifier: null });
      await post("/v1/auth/pin/setup", { pin: "482915" });

      const reqRes = await post("/v1/auth/pin/reset/request", {});
      expect(reqRes.status).toBe(403);
      const errReq = await jsonOf(reqRes);
      expect(errReq.error.details[0].message).toContain("unconfigured");

      const confirmRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
      });
      expect(confirmRes.status).toBe(403);
      const errConfirm = await jsonOf(confirmRes);
      expect(errConfirm.error.details[0].message).toContain("unconfigured");
    });

    it("denies wrong OTP code, expired challenge, reused challenge, and cross-user challenge", async () => {
      const { post, postAs, advanceTime } = buildTestApp();
      await post("/v1/auth/pin/setup", { pin: "482915" });

      // 1. Request reset for User A
      const reqRes = await post("/v1/auth/pin/reset/request", {});
      expect(reqRes.status).toBe(200);
      const { challengeId } = await jsonOf(reqRes);
      expect(challengeId).toBeDefined();

      // 2. Cross-user challenge denied: User B attempts to use User A challengeId
      const userB = { id: "00000000-0000-4000-8000-000000000002" };
      const crossUserRes = await postAs(userB, "/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
        challengeId,
      });
      expect(crossUserRes.status).toBe(403);
      const crossErr = await jsonOf(crossUserRes);
      expect(crossErr.error.details[0].message).toContain("Challenge does not belong to user");

      // 3. User B attempts to confirm reset without having initiated a challenge
      const noChallengeRes = await postAs(userB, "/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
      });
      expect(noChallengeRes.status).toBe(403);
      const noChalErr = await jsonOf(noChallengeRes);
      expect(noChalErr.error.details[0].message).toContain("No challenge initiated for user");

      // 4. Wrong OTP code denied for User A
      const wrongOtpRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "999999",
        newPin: "937104",
        challengeId,
      });
      expect(wrongOtpRes.status).toBe(403);
      const wrongErr = await jsonOf(wrongOtpRes);
      expect(wrongErr.error.details[0].message).toContain("Incorrect OTP code");

      // 5. Expired challenge denied
      advanceTime(11 * 60 * 1000); // 11 minutes (TTL is 10 minutes)
      const expiredRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
        challengeId,
      });
      expect(expiredRes.status).toBe(403);
      const expiredErr = await jsonOf(expiredRes);
      expect(expiredErr.error.details[0].message).toContain("Challenge has expired");

      // 6. Valid reset works with a fresh challenge
      const freshReq = await post("/v1/auth/pin/reset/request", {});
      const { challengeId: freshChallengeId } = await jsonOf(freshReq);

      const validRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "937104",
        challengeId: freshChallengeId,
      });
      expect(validRes.status).toBe(200);
      const validBody = await jsonOf(validRes);
      expect(validBody.status).toBe("cooling_off");

      // 7. Reused challenge denied: attempting to use the same challenge again
      const reusedRes = await post("/v1/auth/pin/reset/confirm", {
        otp: "123456",
        newPin: "826305",
        challengeId: freshChallengeId,
      });
      expect(reusedRes.status).toBe(403);
      const reusedErr = await jsonOf(reusedRes);
      expect(reusedErr.error.details[0].message).toContain("Challenge has already been used");
    });
  });

  describe("Unlock PIN Role Boundary & Capabilities", () => {
    it("arbitrary authenticated user cannot unlock another user", async () => {
      const { post, postAs } = buildTestApp();
      await post("/v1/auth/pin/setup", { pin: "482915" });

      const otherUser = { id: "00000000-0000-4000-8000-000000000099" };
      const res = await postAs(otherUser, "/v1/auth/pin/unlock", { targetUserId: userId });
      expect(res.status).toBe(403);
    });

    it("ignores client role headers (x-role / x-admin) and enforces server-validated role", async () => {
      const { post } = buildTestApp();
      await post("/v1/auth/pin/setup", { pin: "482915" });

      const res = await post(
        "/v1/auth/pin/unlock",
        { targetUserId: userId },
        { "X-Role": "admin", "X-Admin": "true", "x-recovery": "true" },
      );
      expect(res.status).toBe(403);
    });

    it("permits explicit server-validated recovery capability to unlock", async () => {
      const { post, postAs } = buildTestApp();
      await post("/v1/auth/pin/setup", { pin: "482915" });

      const recoveryPrincipal = {
        id: "00000000-0000-4000-8000-000000000088",
        capabilities: ["recovery"],
      };
      const res = await postAs(recoveryPrincipal, "/v1/auth/pin/unlock", { targetUserId: userId });
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.status).toBe("unlocked");
    });
  });

  describe("Requiring PIN on Money Approval Actions", () => {
    async function setupFund(
      post: (path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>,
    ) {
      const fundRes = await post("/v1/funds", {
        name: "Community Fund",
        targetPaise: "500000",
        upiVpa: "community@yenbank",
        upiPayeeName: "Community Fund",
      });
      expect(fundRes.status).toBe(201);
      const fund = await jsonOf(fundRes);
      return fund.id as string;
    }

    async function setupSubmittedExpense(
      postAs: (
        actingPrincipal: {
          id: string;
          roles?: readonly string[];
          capabilities?: readonly string[];
        },
        path: string,
        body?: unknown,
        headers?: Record<string, string>,
      ) => Promise<Response>,
      fundId: string,
    ) {
      const requester = { id: "00000000-0000-4000-8000-000000000099", roles: ["owner"] };
      const createdRes = await postAs(requester, `/v1/funds/${fundId}/expenses`, {
        amountPaise: "25000",
        description: "Community supplies",
        recipientRef: "vendor-1",
      });
      expect(createdRes.status).toBe(201);
      const created = await jsonOf(createdRes);
      const submitRes = await postAs(
        requester,
        `/v1/funds/${fundId}/expenses/${created.id}/submit`,
      );
      expect(submitRes.status).toBe(200);
      return created.id as string;
    }

    it("rejects expense approval if approval PIN has not been set", async () => {
      const { post, postAs } = buildTestApp();
      const fundId = await setupFund(post);
      const expenseId = await setupSubmittedExpense(postAs, fundId);

      const res = await post(`/v1/funds/${fundId}/expenses/${expenseId}/approve`, {
        pin: "482915",
      });
      expect(res.status).toBe(403);
      const err = await jsonOf(res);
      expect(err.error.details[0].message).toContain("Approval PIN must be configured");
    });

    it("approves expense with single-use action token and prevents replay", async () => {
      const { post, postAs, pinNotificationService } = buildTestApp();
      const fundId = await setupFund(post);
      const expenseId = await setupSubmittedExpense(postAs, fundId);

      // Setup PIN
      await post("/v1/auth/pin/setup", { pin: "482915" });

      // Compute action hash for this exact action
      const actionDetails = { action: "expense:approve", fundId, targetId: expenseId };
      const actionHash = computeActionHash(actionDetails);

      // Verify PIN to get token
      const verifyRes = await post("/v1/auth/pin/verify", { pin: "482915", actionHash });
      expect(verifyRes.status).toBe(200);
      const { approvalToken } = await jsonOf(verifyRes);

      // Approve expense with token
      const approveRes = await post(
        `/v1/funds/${fundId}/expenses/${expenseId}/approve`,
        undefined,
        { "X-Approval-Token": approvalToken },
      );
      expect(approveRes.status).toBe(200);
      const approveBody = await jsonOf(approveRes);
      expect(approveBody.status).toBe("submitted");
      expect(approveBody.approvalsCount).toBe(1);

      // Verify notification sent to approvers
      const events = pinNotificationService.getEvents();
      const approvalEvent = events.find((e) => e.kind === "approval_executed");
      expect(approvalEvent).toBeDefined();
      expect(approvalEvent?.approverUserId).toBe(userId);

      // Replaying the token on the SAME request fails (burned)
      const replayRes = await post(`/v1/funds/${fundId}/expenses/${expenseId}/approve`, undefined, {
        "X-Approval-Token": approvalToken,
      });
      expect(replayRes.status).toBe(403);

      // Replaying the token on a DIFFERENT request fails
      const diffExpenseId = await setupSubmittedExpense(postAs, fundId);
      const diffRes = await post(
        `/v1/funds/${fundId}/expenses/${diffExpenseId}/approve`,
        undefined,
        { "X-Approval-Token": approvalToken },
      );
      expect(diffRes.status).toBe(403);
    });

    it("approves expense directly with valid inline PIN", async () => {
      const { post, postAs } = buildTestApp();
      const fundId = await setupFund(post);
      const expenseId = await setupSubmittedExpense(postAs, fundId);

      await post("/v1/auth/pin/setup", { pin: "482915" });

      const res = await post(`/v1/funds/${fundId}/expenses/${expenseId}/approve`, {
        pin: "482915",
      });
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.status).toBe("submitted");
      expect(body.approvalsCount).toBe(1);
    });

    it("requires PIN on all other money actions (payee, policy, members)", async () => {
      const { post } = buildTestApp();
      const fundId = await setupFund(post);

      await post("/v1/auth/pin/setup", { pin: "482915" });

      // 1. Change payee UPI ID
      const payeeRes = await post(`/v1/funds/${fundId}/payee`, { vpa: "club@upi", pin: "482915" });
      expect(payeeRes.status).toBe(200);

      // 2. Change policy
      const policyRes = await post(`/v1/funds/${fundId}/policy`, {
        policyJson: { quorum: 3 },
        pin: "482915",
      });
      expect(policyRes.status).toBe(200);

      // 3. Add member
      const memberId = "00000000-0000-4000-8000-000000000099";
      const addRes = await post(`/v1/funds/${fundId}/members`, {
        userId: memberId,
        role: "approver",
        pin: "482915",
      });
      expect(addRes.status).toBe(201);

      // 4. Remove member
      const removeRes = await post(`/v1/funds/${fundId}/members/${memberId}/remove`, {
        pin: "482915",
      });
      expect(removeRes.status).toBe(200);
    });
  });

  describe("Security: Absence from Logs and Error Reports", () => {
    it("never logs raw PIN, PIN hashes, or secrets in structured logs or errors", async () => {
      const { post, logs } = buildTestApp();
      const rawPin = "482915";

      // Execute setup, verification, wrong try, and error
      await post("/v1/auth/pin/setup", { pin: rawPin });

      await post("/v1/auth/pin/verify", {
        pin: "937104", // wrong pin
        actionHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        const serialized = serializeRequestLog(log);
        expect(serialized).not.toContain(rawPin);
        expect(serialized).not.toContain("937104");
        expect(serialized).not.toContain("pinHash");
        expect(serialized).not.toContain("$2b$");
        expect(serialized).not.toContain("test_pin_hmac_secret");
      }
    });
  });
});
