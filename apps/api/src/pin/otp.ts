export interface PinOtpVerifier {
  createChallenge(userId: string, channel: "whatsapp" | "sms"): Promise<{ challengeId: string }>;
  verifyChallenge(params: {
    userId: string;
    otp: string;
    challengeId?: string | undefined;
  }): Promise<{ valid: boolean; reason?: string }>;
}
