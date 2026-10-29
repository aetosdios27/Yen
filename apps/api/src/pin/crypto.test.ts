import { describe, expect, it } from "vitest";
import {
  computeActionHash,
  computePinKeyedDigest,
  generatePinSalt,
  hashPin,
  verifyPinHash,
} from "./crypto.js";

describe("PIN Crypto", () => {
  const secret = "test_hmac_secret_32_bytes_long_minimum_required";
  const userId = "018f9872-4682-7890-8123-456789abcdef";

  it("generates 32-character hex salt", () => {
    const salt1 = generatePinSalt();
    const salt2 = generatePinSalt();
    expect(salt1).toMatch(/^[0-9a-f]{32}$/);
    expect(salt2).toMatch(/^[0-9a-f]{32}$/);
    expect(salt1).not.toBe(salt2);
  });

  it("produces deterministic keyed HMAC digest for identical inputs and different for others", () => {
    const salt = generatePinSalt();
    const digest1 = computePinKeyedDigest(userId, salt, "482915", secret);
    const digest2 = computePinKeyedDigest(userId, salt, "482915", secret);
    expect(digest1).toBe(digest2);

    const diffPin = computePinKeyedDigest(userId, salt, "482916", secret);
    expect(diffPin).not.toBe(digest1);

    const diffSecret = computePinKeyedDigest(userId, salt, "482915", "different_secret");
    expect(diffSecret).not.toBe(digest1);

    const diffUser = computePinKeyedDigest("other-user", salt, "482915", secret);
    expect(diffUser).not.toBe(digest1);
  });

  it("hashes and verifies PIN using bcrypt with keyed digest", async () => {
    const salt = generatePinSalt();
    const pin = "482915";
    const storedHash = await hashPin(userId, salt, pin, secret, 4); // 4 rounds for fast tests

    expect(storedHash.startsWith("$2")).toBe(true);

    const valid = await verifyPinHash(userId, salt, pin, storedHash, secret);
    expect(valid).toBe(true);

    const wrongPin = await verifyPinHash(userId, salt, "482916", storedHash, secret);
    expect(wrongPin).toBe(false);

    const wrongSecret = await verifyPinHash(userId, salt, pin, storedHash, "wrong_secret");
    expect(wrongSecret).toBe(false);
  });

  it("computes canonical action hash invariant to key order", () => {
    const hash1 = computeActionHash({
      action: "expense:approve",
      fundId: "fund-123",
      amountPaise: "500000",
      payee: "vendor@upi",
    });

    const hash2 = computeActionHash({
      payee: "vendor@upi",
      amountPaise: "500000",
      action: "expense:approve",
      fundId: "fund-123",
    });

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    const hash3 = computeActionHash({
      action: "expense:approve",
      fundId: "fund-123",
      amountPaise: "500001",
      payee: "vendor@upi",
    });
    expect(hash3).not.toBe(hash1);
  });
});
