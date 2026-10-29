import crypto from "node:crypto";
import type { PinOtpVerifier } from "./otp.js";

export interface PinResetChallenge {
  readonly challengeId: string;
  readonly userId: string;
  readonly code: string;
  readonly expiresAt: number;
  consumed: boolean;
}

export interface MemoryPinOtpVerifierOptions {
  readonly clock?: () => number;
  readonly ttlMs?: number;
  readonly defaultCode?: string;
}

export class MemoryPinOtpVerifier implements PinOtpVerifier {
  private readonly challenges = new Map<string, PinResetChallenge>();
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly defaultCode: string;

  constructor(options: MemoryPinOtpVerifierOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000; // 10 minutes
    this.defaultCode = options.defaultCode ?? "123456";
  }

  async createChallenge(
    userId: string,
    _channel: "whatsapp" | "sms",
  ): Promise<{ challengeId: string; code: string }> {
    const challengeId = crypto.randomUUID();
    const code = this.defaultCode;
    const now = this.clock();
    const challenge: PinResetChallenge = {
      challengeId,
      userId,
      code,
      expiresAt: now + this.ttlMs,
      consumed: false,
    };
    this.challenges.set(challengeId, challenge);
    return { challengeId, code };
  }

  async verifyChallenge(params: {
    userId: string;
    otp: string;
    challengeId?: string | undefined;
  }): Promise<{ valid: boolean; reason?: string }> {
    const now = this.clock();
    let challenge: PinResetChallenge | undefined;

    if (params.challengeId) {
      challenge = this.challenges.get(params.challengeId);
      if (!challenge) {
        return { valid: false, reason: "Challenge not found" };
      }
      if (challenge.userId !== params.userId) {
        return { valid: false, reason: "Challenge does not belong to user" };
      }
    } else {
      // Find latest challenge for this user
      const userChallenges = Array.from(this.challenges.values())
        .filter((c) => c.userId === params.userId)
        .sort((a, b) => b.expiresAt - a.expiresAt);

      challenge = userChallenges.find((c) => !c.consumed) ?? userChallenges[0];
      if (!challenge) {
        return { valid: false, reason: "No challenge initiated for user" };
      }
    }

    if (challenge.consumed) {
      return { valid: false, reason: "Challenge has already been used" };
    }

    if (now > challenge.expiresAt) {
      return { valid: false, reason: "Challenge has expired" };
    }

    if (challenge.code !== params.otp.trim()) {
      return { valid: false, reason: "Incorrect OTP code" };
    }

    challenge.consumed = true;
    return { valid: true };
  }
}
