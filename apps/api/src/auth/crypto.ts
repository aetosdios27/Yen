import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Generates a cryptographically secure 6-digit numeric OTP string.
 */
export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * Generates a random cryptographic salt.
 */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Hashes an OTP code at rest with salt using SHA-256.
 */
export function hashOtp(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

/**
 * Constant-time verification of an entered OTP code against the stored hash.
 */
export function verifyOtp(salt: string, code: string, expectedHash: string): boolean {
  const computed = hashOtp(salt, code);
  if (computed.length !== expectedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(expectedHash));
}

/**
 * Generates a 256-bit cryptographically secure session token in hex (64 chars).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hashes a session token using SHA-256 for secure storage at rest.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
