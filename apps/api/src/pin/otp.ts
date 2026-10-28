export interface PinOtpVerifier {
  createChallenge(userId: string): Promise<{ challengeId: string }>;
  verifyChallenge(params: {
    userId: string;
    otp: string;
    challengeId?: string | undefined;
  }): Promise<{ valid: boolean; reason?: string }>;
}
