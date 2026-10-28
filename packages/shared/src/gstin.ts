import * as z from "zod/mini";
import type { Result } from "./ids.js";

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Checks whether an input string matches the 15-character Indian GSTIN format regex.
 */
export function isValidGstinFormat(value: string): boolean {
  return GSTIN_REGEX.test(value);
}

/**
 * Computes the 15th checksum character for the first 14 characters of a GSTIN
 * using the official modulo 36 checksum algorithm.
 */
export function calculateGstinChecksum(prefix14: string): string {
  if (prefix14.length !== 14 || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z$/.test(prefix14)) {
    throw new RangeError("Expected valid 14-character GSTIN prefix");
  }
  const mod = GSTIN_ALPHABET.length;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const char = prefix14[i];
    if (char === undefined) {
      throw new RangeError("Invalid character index in GSTIN prefix");
    }
    const code = GSTIN_ALPHABET.indexOf(char);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = code * factor;
    total += Math.floor(product / mod) + (product % mod);
  }
  const remainder = total % mod;
  const checkCode = (mod - remainder) % mod;
  const checkChar = GSTIN_ALPHABET[checkCode];
  if (checkChar === undefined) {
    throw new RangeError("Invalid checksum character index");
  }
  return checkChar;
}

/**
 * Verifies both the structural format and the modulo 36 checksum of a 15-character GSTIN.
 */
export function validateGstinChecksum(gstin: string): boolean {
  if (!isValidGstinFormat(gstin)) {
    return false;
  }
  return gstin[14] === calculateGstinChecksum(gstin.slice(0, 14));
}

export const gstinSchema = z
  .string()
  .check(z.regex(GSTIN_REGEX), z.refine(validateGstinChecksum, "Invalid GSTIN modulo 36 checksum"))
  .brand<"Gstin">();

export type Gstin = z.infer<typeof gstinSchema>;

/**
 * Parses and validates an unknown input as a canonical Indian GSTIN.
 */
export function parseGstin(input: unknown): Result<Gstin> {
  if (typeof input !== "string") {
    return { ok: false, error: "Expected GSTIN string" };
  }
  const trimmed = input.trim().toUpperCase();
  if (!isValidGstinFormat(trimmed)) {
    return { ok: false, error: "Expected valid 15-character Indian GSTIN format" };
  }
  if (!validateGstinChecksum(trimmed)) {
    return { ok: false, error: "Invalid GSTIN modulo 36 checksum" };
  }
  const parsed = gstinSchema.safeParse(trimmed);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Invalid GSTIN" };
}
