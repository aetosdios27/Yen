import { ApiError } from "../errors.js";
import { computeActionHash, generatePinSalt, hashPin, verifyPinHash } from "./crypto.js";
import type { PinNotificationService } from "./notifications.js";
import { type PinValidationContext, validatePin } from "./rules.js";
import type { ActionTokenStore, PinStore } from "./store.js";

export interface PinServiceOptions {
  readonly pinStore: PinStore;
  readonly actionTokenStore: ActionTokenStore;
  readonly notificationService: PinNotificationService;
  readonly pinSecret: string;
  readonly clock?: () => number;
  readonly lockoutDurationMs?: number; // default 30 minutes
  readonly coolingOffDurationMs?: number; // default 24 hours
  readonly tokenTtlMs?: number; // default 60 seconds
}

export interface SanitizedPinStatus {
  readonly isSet: boolean;
  readonly status: "not_set" | "active" | "locked_out" | "cooling_off" | "rate_limited";
  readonly lockedUntil: string | null;
  readonly coolingOffUntil: string | null;
  readonly failedAttempts: number;
}

export class PinService {
  private readonly pinStore: PinStore;
  private readonly actionTokenStore: ActionTokenStore;
  private readonly notificationService: PinNotificationService;
  private readonly pinSecret: string;
  private readonly clock: () => number;
  private readonly lockoutDurationMs: number;
  private readonly coolingOffDurationMs: number;
  private readonly tokenTtlMs: number;

  constructor(options: PinServiceOptions) {
    this.pinStore = options.pinStore;
    this.actionTokenStore = options.actionTokenStore;
    this.notificationService = options.notificationService;
    this.pinSecret = options.pinSecret;
    this.clock = options.clock ?? Date.now;
    this.lockoutDurationMs = options.lockoutDurationMs ?? 30 * 60 * 1000;
    this.coolingOffDurationMs = options.coolingOffDurationMs ?? 24 * 60 * 60 * 1000;
    this.tokenTtlMs = options.tokenTtlMs ?? 60 * 1000;
  }

  async setupPin(userId: string, pin: string, context?: PinValidationContext): Promise<void> {
    const existing = await this.pinStore.get(userId);
    if (existing) {
      throw new ApiError("conflict", [
        { path: ["json", "pin"], message: "Approval PIN is already configured" },
      ]);
    }

    const validation = validatePin(pin, context);
    if (!validation.valid) {
      throw new ApiError("validation_failed", [
        { path: ["json", "pin"], message: validation.reason ?? "Invalid PIN" },
      ]);
    }

    const salt = generatePinSalt();
    const pinHash = await hashPin(userId, salt, pin, this.pinSecret);

    await this.pinStore.create({
      userId,
      salt,
      pinHash,
      failedAttempts: 0,
      totalFailed24h: 0,
      firstFailedAt: null,
      lockedUntil: null,
      coolingOffUntil: null,
      status: "active",
    });
  }

  async getPinStatus(userId: string): Promise<SanitizedPinStatus> {
    const record = await this.pinStore.get(userId);
    if (!record) {
      return {
        isSet: false,
        status: "not_set",
        lockedUntil: null,
        coolingOffUntil: null,
        failedAttempts: 0,
      };
    }

    const now = this.clock();
    let effectiveStatus: SanitizedPinStatus["status"] = record.status;

    if (record.status === "cooling_off") {
      if (record.coolingOffUntil && now >= record.coolingOffUntil) {
        effectiveStatus = "active";
      }
    } else if (record.status === "active") {
      if (record.lockedUntil && now < record.lockedUntil) {
        effectiveStatus = "rate_limited";
      }
    }

    return {
      isSet: true,
      status: effectiveStatus,
      lockedUntil: record.lockedUntil ? new Date(record.lockedUntil).toISOString() : null,
      coolingOffUntil: record.coolingOffUntil
        ? new Date(record.coolingOffUntil).toISOString()
        : null,
      failedAttempts: record.failedAttempts,
    };
  }

  async verifyPin(
    userId: string,
    pin: string,
    actionHash: string,
  ): Promise<{ approvalToken: string; expiresAt: string }> {
    let record = await this.pinStore.get(userId);
    if (!record) {
      throw new ApiError("forbidden", [
        {
          path: ["json", "pin"],
          message: "Approval PIN must be configured before approving actions",
        },
      ]);
    }

    const now = this.clock();

    // 1. Check permanent 24h lockout (10 wrong attempts)
    if (record.status === "locked_out") {
      throw new ApiError("forbidden", [
        {
          path: ["json", "pin"],
          message: "PIN locked out after 10 failed attempts; support or owner reset required",
        },
      ]);
    }

    // 2. Check 24-hour cooling-off period after reset
    if (record.status === "cooling_off") {
      if (record.coolingOffUntil && now < record.coolingOffUntil) {
        throw new ApiError("forbidden", [
          {
            path: ["json", "pin"],
            message: "PIN is currently in 24-hour cooling-off period following reset",
          },
        ]);
      }
    }

    // 3. Check 30-minute rate limit lock (5 consecutive failed attempts)
    if (record.lockedUntil) {
      if (now < record.lockedUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
        const err = new ApiError("rate_limited", [
          {
            path: ["json", "pin"],
            message: `PIN is temporarily locked. Try again in ${retryAfterSeconds} seconds.`,
          },
        ]);
        throw Object.assign(err, { retryAfterSeconds });
      }
      // Lockout duration has elapsed: reset consecutive counter
      await this.pinStore.update(userId, {
        lockedUntil: null,
        failedAttempts: 0,
      });
      record = {
        ...record,
        lockedUntil: null,
        failedAttempts: 0,
      };
    }

    // 4. Verify PIN hash
    const isValid = await verifyPinHash(userId, record.salt, pin, record.pinHash, this.pinSecret);

    if (!isValid) {
      // Manage 24h rolling window
      const isNewWindow =
        record.firstFailedAt === null || now - record.firstFailedAt > 24 * 60 * 60 * 1000;
      const totalFailed24h = isNewWindow ? 1 : record.totalFailed24h + 1;
      const firstFailedAt = isNewWindow ? now : record.firstFailedAt;
      const failedAttempts = record.failedAttempts + 1;

      if (totalFailed24h >= 10) {
        await this.pinStore.update(userId, {
          status: "locked_out",
          failedAttempts,
          totalFailed24h,
          firstFailedAt,
        });

        await this.notificationService.notify({
          kind: "pin_lockout",
          userId,
          recipientRoles: ["approver", "owner"],
          reason: "max_attempts_exceeded",
        });

        throw new ApiError("forbidden", [
          {
            path: ["json", "pin"],
            message: "PIN locked out after 10 failed attempts in 24 hours; support reset required",
          },
        ]);
      }

      if (failedAttempts >= 5) {
        const lockedUntil = now + this.lockoutDurationMs;
        await this.pinStore.update(userId, {
          lockedUntil,
          failedAttempts,
          totalFailed24h,
          firstFailedAt,
        });
        const retryAfterSeconds = Math.ceil(this.lockoutDurationMs / 1000);
        const err = new ApiError("rate_limited", [
          {
            path: ["json", "pin"],
            message: "PIN locked for 30 minutes after 5 failed attempts",
          },
        ]);
        throw Object.assign(err, { retryAfterSeconds });
      }

      await this.pinStore.update(userId, {
        failedAttempts,
        totalFailed24h,
        firstFailedAt,
      });

      const remaining = 5 - failedAttempts;
      throw new ApiError("forbidden", [
        {
          path: ["json", "pin"],
          message: `Incorrect PIN (${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout)`,
        },
      ]);
    }

    // Success: reset consecutive failures, preserve totalFailed24h window
    await this.pinStore.update(userId, {
      failedAttempts: 0,
      lockedUntil: null,
      status: "active",
    });

    const approvalToken = await this.actionTokenStore.createToken(
      userId,
      actionHash,
      this.tokenTtlMs,
    );
    const expiresAt = new Date(now + this.tokenTtlMs).toISOString();

    return { approvalToken, expiresAt };
  }

  async changePin(
    userId: string,
    currentPin: string,
    newPin: string,
    context?: PinValidationContext,
  ): Promise<void> {
    const record = await this.pinStore.get(userId);
    if (!record) {
      throw new ApiError("forbidden", [
        { path: ["json", "currentPin"], message: "PIN is not configured" },
      ]);
    }

    // Verify current PIN (subject to same verification constraints)
    const dummyActionHash = computeActionHash({ action: "pin:change", userId });
    await this.verifyPin(userId, currentPin, dummyActionHash);

    if (currentPin === newPin) {
      throw new ApiError("validation_failed", [
        { path: ["json", "newPin"], message: "New PIN must be different from current PIN" },
      ]);
    }

    const validation = validatePin(newPin, context);
    if (!validation.valid) {
      throw new ApiError("validation_failed", [
        { path: ["json", "newPin"], message: validation.reason ?? "Invalid PIN" },
      ]);
    }

    const newSalt = generatePinSalt();
    const newHash = await hashPin(userId, newSalt, newPin, this.pinSecret);

    await this.pinStore.update(userId, {
      salt: newSalt,
      pinHash: newHash,
      failedAttempts: 0,
      lockedUntil: null,
      status: "active",
    });
  }

  async requestReset(_userId: string): Promise<{ challengeId: string }> {
    return { challengeId: crypto.randomUUID() };
  }

  async confirmReset(
    userId: string,
    otp: string,
    newPin: string,
    context?: PinValidationContext,
  ): Promise<{ coolingOffUntil: string }> {
    if (!otp || otp.trim().length === 0) {
      throw new ApiError("validation_failed", [
        { path: ["json", "otp"], message: "OTP is required" },
      ]);
    }

    const validation = validatePin(newPin, context);
    if (!validation.valid) {
      throw new ApiError("validation_failed", [
        { path: ["json", "newPin"], message: validation.reason ?? "Invalid PIN" },
      ]);
    }

    const now = this.clock();
    const coolingOffUntilMs = now + this.coolingOffDurationMs;
    const coolingOffUntilIso = new Date(coolingOffUntilMs).toISOString();

    const newSalt = generatePinSalt();
    const newHash = await hashPin(userId, newSalt, newPin, this.pinSecret);

    const record = await this.pinStore.get(userId);
    if (record) {
      await this.pinStore.update(userId, {
        salt: newSalt,
        pinHash: newHash,
        failedAttempts: 0,
        totalFailed24h: 0,
        firstFailedAt: null,
        lockedUntil: null,
        coolingOffUntil: coolingOffUntilMs,
        status: "cooling_off",
      });
    } else {
      await this.pinStore.create({
        userId,
        salt: newSalt,
        pinHash: newHash,
        failedAttempts: 0,
        totalFailed24h: 0,
        firstFailedAt: null,
        lockedUntil: null,
        coolingOffUntil: coolingOffUntilMs,
        status: "cooling_off",
      });
    }

    await this.notificationService.notify({
      kind: "pin_reset",
      userId,
      recipientRoles: ["all_fund_members"],
      coolingOffUntil: coolingOffUntilIso,
    });

    return { coolingOffUntil: coolingOffUntilIso };
  }

  async unlockPin(targetUserId: string): Promise<void> {
    const record = await this.pinStore.get(targetUserId);
    if (!record) {
      throw new ApiError("not_found", [
        { path: ["param", "targetUserId"], message: "User PIN not found" },
      ]);
    }
    await this.pinStore.update(targetUserId, {
      status: "active",
      failedAttempts: 0,
      totalFailed24h: 0,
      firstFailedAt: null,
      lockedUntil: null,
      coolingOffUntil: null,
    });
  }

  async verifyAction(
    userId: string,
    actionDetails: Record<string, unknown>,
    options: { pin?: string | undefined; approvalToken?: string | undefined },
  ): Promise<void> {
    const actionHash = computeActionHash(actionDetails);

    if (options.approvalToken) {
      const consumed = await this.actionTokenStore.consumeToken(
        userId,
        actionHash,
        options.approvalToken,
      );
      if (!consumed) {
        throw new ApiError("forbidden", [
          {
            path: ["header", "x-approval-token"],
            message: "Invalid, expired, or already-used approval token",
          },
        ]);
      }
      return;
    }

    if (options.pin) {
      // Verifies PIN against this action
      await this.verifyPin(userId, options.pin, actionHash);
      return;
    }

    throw new ApiError("forbidden", [
      {
        path: ["header", "x-approval-token"],
        message: "Money action requires 6-digit approval PIN or valid approval token",
      },
    ]);
  }
}
