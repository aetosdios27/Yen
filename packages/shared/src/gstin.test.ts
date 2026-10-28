import { describe, expect, it } from "vitest";
import {
  calculateGstinChecksum,
  gstinSchema,
  isValidGstinFormat,
  parseGstin,
  validateGstinChecksum,
} from "./gstin.js";

// Known valid Indian GSTIN test vectors verified against official modulo 36 algorithm
const VALID_GSTINS = [
  "27AAPFU0939F1ZV", // Maharashtra (Firm)
  "09AAAUP8175A1ZG", // Uttar Pradesh (Company)
  "24AAACR4542E1ZS", // Gujarat (Reliance Industries)
  "27AAACT2727Q1ZW", // Maharashtra (Tata Consultancy Services)
  "29AAACI4397C1ZI", // Karnataka (Infosys)
  "29AASCS2460H1ZW", // Karnataka (Entity code 1)
  "07AABCS1429B1ZW", // Delhi
] as const;

// Valid structural format, but corrupted 15th checksum character
const INVALID_CHECKSUM_GSTINS = [
  "27AAPFU0939F1ZO", // expected V
  "09AAAUP8175A1Z0", // expected G
  "24AAACR4542E1ZA", // expected S
  "27AAACT2727Q1Z1", // expected W
  "29AAACI4397C1ZA", // expected I
] as const;

// Structurally invalid GSTINs failing the official GSTIN regex
const INVALID_FORMAT_GSTINS = [
  "",
  "27AAPFU0939F1Z", // only 14 characters (missing checksum)
  "27AAPFU0939F1ZVV", // 16 characters (too long)
  "27AAPFU0939F1A", // missing 14th 'Z' and 15th char
  "27AAPFU0939F1AV", // 14th char is 'A' instead of 'Z'
  "A7AAPFU0939F1ZV", // state code has non-digits
  "271APFU0939F1ZV", // PAN has digit in first 5 characters
  "27AAPFU093911ZV", // PAN 10th char has digit instead of letter
  "27AAPFU0939F0ZV", // 13th char is '0' (must be 1-9 or A-Z)
  "27AAPFU0939F!ZV", // illegal symbol
  "27aapfu0939f1zv", // lowercase
] as const;

describe("GSTIN format validation", () => {
  it("accepts known valid GSTIN structures", () => {
    for (const gstin of VALID_GSTINS) {
      expect(isValidGstinFormat(gstin)).toBe(true);
    }
  });

  it("accepts strings matching the structural regex even if checksum is wrong", () => {
    for (const gstin of INVALID_CHECKSUM_GSTINS) {
      expect(isValidGstinFormat(gstin)).toBe(true);
    }
  });

  it("rejects malformed GSTIN strings", () => {
    for (const gstin of INVALID_FORMAT_GSTINS) {
      expect(isValidGstinFormat(gstin)).toBe(false);
    }
  });
});

describe("GSTIN modulo 36 checksum calculation and validation", () => {
  it("computes the expected 15th character for known 14-character prefixes", () => {
    for (const gstin of VALID_GSTINS) {
      const prefix14 = gstin.slice(0, 14);
      const expectedCheckChar = gstin[14];
      expect(calculateGstinChecksum(prefix14)).toBe(expectedCheckChar);
    }
  });

  it("validates full GSTIN strings with correct checksum", () => {
    for (const gstin of VALID_GSTINS) {
      expect(validateGstinChecksum(gstin)).toBe(true);
    }
  });

  it("rejects full GSTIN strings with invalid checksum", () => {
    for (const gstin of INVALID_CHECKSUM_GSTINS) {
      expect(validateGstinChecksum(gstin)).toBe(false);
    }
  });

  it("rejects malformed strings in validateGstinChecksum", () => {
    for (const gstin of INVALID_FORMAT_GSTINS) {
      expect(validateGstinChecksum(gstin)).toBe(false);
    }
  });

  it("throws RangeError when calculateGstinChecksum is called with invalid prefix", () => {
    expect(() => calculateGstinChecksum("27AAPFU0939F1")).toThrow(RangeError);
    expect(() => calculateGstinChecksum("27AAPFU0939F1ZZ")).toThrow(RangeError);
    expect(() => calculateGstinChecksum("27AAPFU0939F1A")).toThrow(RangeError);
  });
});

describe("GSTIN parser and schema", () => {
  it("parses valid GSTINs successfully", () => {
    for (const gstin of VALID_GSTINS) {
      const result = parseGstin(gstin);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(gstin);
      }
    }
  });

  it("normalizes whitespace and case in parseGstin", () => {
    const result = parseGstin("  27aapfu0939f1zv  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("27AAPFU0939F1ZV");
    }
  });

  it("fails parseGstin with non-string inputs", () => {
    expect(parseGstin(null).ok).toBe(false);
    expect(parseGstin(undefined).ok).toBe(false);
    expect(parseGstin(12345).ok).toBe(false);
    expect(parseGstin({}).ok).toBe(false);
  });

  it("fails parseGstin with format errors", () => {
    const result = parseGstin("invalid-gstin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("format");
    }
  });

  it("fails parseGstin with checksum errors", () => {
    const result = parseGstin("27AAPFU0939F1ZO");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("checksum");
    }
  });

  it("validates using gstinSchema", () => {
    expect(gstinSchema.safeParse("27AAPFU0939F1ZV").success).toBe(true);
    expect(gstinSchema.safeParse("27AAPFU0939F1ZO").success).toBe(false);
    expect(gstinSchema.safeParse("not-a-gstin").success).toBe(false);
  });
});
