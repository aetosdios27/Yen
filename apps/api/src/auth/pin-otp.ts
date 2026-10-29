import { ApiError } from "../errors.js";
import type { PinOtpVerifier } from "../pin/otp.js";
import type { RateLimit, RateLimitStore } from "../stores.js";
import { generateOtpCode, generateSalt, hashOtp, verifyOtp } from "./crypto.js";
import type { AuthStore, OtpDeliveryProvider } from "./index.js";

interface AuthPinOtpVerifierOptions {
  readonly authStore: AuthStore;
  readonly deliveryProvider: OtpDeliveryProvider;
  readonly rateLimitStore: RateLimitStore;
  readonly phoneRateLimit: RateLimit;
  readonly otpHashKey: string;
  readonly clock: () => number;
  readonly idGenerator: () => string;
  readonly cooldownMs: number;
  readonly expiryMs: number;
  readonly maxAttempts: number;
}

export class AuthPinOtpVerifier implements PinOtpVerifier {
  constructor(private readonly options: AuthPinOtpVerifierOptions) {}

  async createChallenge(userId: string, channel: "whatsapp" | "sms") {
    const { authStore, clock } = this.options;
    const now = clock();
    const user = await authStore.getUserById(userId);
    if (!user) throw new ApiError("unauthenticated");
    const active = await authStore.getLatestActiveOtpChallenge(user.phone, now);
    if (active && now < active.resendAvailableAt) throw new ApiError("rate_limited");

    const rate = await this.options.rateLimitStore.consume(
      JSON.stringify(["otp_send_phone", user.phone]),
      this.options.phoneRateLimit,
      now,
    );
    if (!rate.allowed) throw new ApiError(rate.overloaded ? "overloaded" : "rate_limited");

    const code = generateOtpCode();
    const salt = generateSalt();
    const delivery = await this.options.deliveryProvider.sendOtp({
      phone: user.phone,
      code,
      preferredChannel: channel,
    });
    if (!delivery.success || delivery.channel !== channel) throw new ApiError("internal");

    const id = this.options.idGenerator();
    await authStore.createOtpChallenge({
      id,
      phone: user.phone,
      otpHash: hashOtp(this.options.otpHashKey, salt, code),
      salt,
      channel,
      expiresAt: now + this.options.expiryMs,
      resendAvailableAt: now + this.options.cooldownMs,
      maxAttempts: this.options.maxAttempts,
      createdAt: now,
    });
    return { challengeId: id };
  }

  async verifyChallenge({
    userId,
    otp,
    challengeId,
  }: {
    userId: string;
    otp: string;
    challengeId?: string;
  }) {
    if (!challengeId) return { valid: false, reason: "Invalid, expired, or already-used OTP" };
    const now = this.options.clock();
    const challenge = await this.options.authStore.getOtpChallengeById(challengeId, now);
    const user = await this.options.authStore.getUserById(userId);
    if (!challenge || !user || challenge.phone !== user.phone) {
      return { valid: false, reason: "Invalid, expired, or already-used OTP" };
    }
    if (
      !(await this.options.authStore.consumeOtpAttempt(
        user.phone,
        this.options.maxAttempts,
        now,
        this.options.expiryMs,
      ))
    ) {
      return { valid: false, reason: "Too many failed OTP attempts" };
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      return { valid: false, reason: "Too many failed OTP attempts" };
    }
    if (!verifyOtp(this.options.otpHashKey, challenge.salt, otp, challenge.otpHash)) {
      await this.options.authStore.incrementOtpAttempts(challenge.id, now);
      return { valid: false, reason: "Invalid, expired, or already-used OTP" };
    }
    if (!(await this.options.authStore.consumeOtpChallenge(challenge.id, now))) {
      return { valid: false, reason: "Invalid, expired, or already-used OTP" };
    }
    return { valid: true };
  }
}
