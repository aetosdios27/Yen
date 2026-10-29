import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export function generatePinSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function computePinKeyedDigest(
  userId: string,
  salt: string,
  pin: string,
  secret: string,
): string {
  if (!secret) {
    throw new Error("PIN HMAC secret must be provided");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`yen:pin:${userId}:${salt}:${pin}`)
    .digest("hex");
}

export async function hashPin(
  userId: string,
  salt: string,
  pin: string,
  secret: string,
  rounds = 10,
): Promise<string> {
  const digest = computePinKeyedDigest(userId, salt, pin, secret);
  return bcrypt.hash(digest, rounds);
}

export async function verifyPinHash(
  userId: string,
  salt: string,
  pin: string,
  storedHash: string,
  secret: string,
): Promise<boolean> {
  if (!storedHash) return false;
  const digest = computePinKeyedDigest(userId, salt, pin, secret);
  return bcrypt.compare(digest, storedHash);
}

export function computeActionHash(details: Record<string, unknown>): string {
  const sortedKeys = Object.keys(details).sort();
  const canonicalObject: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonicalObject[key] = details[key];
  }
  const serialized = JSON.stringify(canonicalObject);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}
