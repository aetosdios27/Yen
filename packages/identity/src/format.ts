import { randomInt } from "node:crypto";
import * as z from "zod";
import { computeDammCheckDigit, validateDammCheckDigit } from "./damm.js";

/**
 * Branded type representing a validated 9-digit Yen ID.
 * Exactly 9 digits, leading digit 1-9, last digit is the valid Damm check digit.
 */
export const yenIdSchema = z
  .string()
  .check(z.regex(/^[1-9][0-9]{8}$/))
  .brand<"YenId">();

export type YenId = z.infer<typeof yenIdSchema>;

export type YenIdParseErrorCode =
  | "CONTAINS_LETTERS"
  | "INVALID_CHARACTERS"
  | "INVALID_LENGTH"
  | "LEADING_ZERO"
  | "INVALID_CHECK_DIGIT";

export interface YenIdParseError {
  readonly code: YenIdParseErrorCode;
  readonly message: string;
}

export type ParseYenIdResult =
  | { readonly ok: true; readonly value: YenId }
  | { readonly ok: false; readonly error: YenIdParseError };

/**
 * Generates a fresh random 9-digit Yen ID.
 *
 * Rules:
 * - First digit is randomly chosen from 1-9 (never 0, preventing spreadsheet truncation).
 * - Next 7 digits are randomly chosen from 0-9 via crypto.randomInt.
 * - 9th digit is the calculated Damm check digit over the 8 body digits.
 */
export function generateYenId(): YenId {
  const d1 = randomInt(1, 10);
  const remaining = Array.from({ length: 7 }, () => randomInt(0, 10));
  const body = [d1, ...remaining];
  const checkDigit = computeDammCheckDigit(body);
  const fullId = [...body, checkDigit].join("");
  return fullId as YenId;
}

/**
 * Formats a 9-digit Yen ID into groups of three separated by spaces:
 * e.g. "482739105" -> "482 739 105".
 */
export function formatYenId(id: YenId | string): string {
  const clean = id.replace(/[\s\-\u2010-\u2015]/g, "");
  if (clean.length !== 9) {
    throw new Error(`Cannot format Yen ID: expected 9 digits, got ${clean.length}`);
  }
  return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
}

/**
 * Parses, normalises, and validates a Yen ID input string.
 *
 * Accepted inputs:
 * - ASCII digits 0-9.
 * - Devanagari digits U+0966 to U+096F (०, १, २, ३, ४, ५, ६, ७, ८, ९), normalised to ASCII.
 * - Separators: whitespace (spaces, tabs, newlines) and hyphens/dashes are stripped.
 *
 * Rejection rules:
 * - Any alphabetic letters (English, Hindi, or any script) are strictly refused.
 * - Leading zero is strictly refused (cannot drop in spreadsheets).
 * - Must be exactly 9 digits after normalisation.
 * - The 9th digit must match the Damm check digit scheme.
 */
export function parseYenId(input: string): ParseYenIdResult {
  if (typeof input !== "string") {
    return {
      ok: false,
      error: {
        code: "INVALID_CHARACTERS",
        message: "Expected input to be a string",
      },
    };
  }

  // 1. Strict rejection of letters (letters are ambiguous when spoken over phone in Hindi/English)
  if (/[a-zA-Z\p{L}]/u.test(input)) {
    return {
      ok: false,
      error: {
        code: "CONTAINS_LETTERS",
        message: "Yen ID must contain digits only; letters are not permitted",
      },
    };
  }

  // 2. Normalisation of separators and Unicode digits
  const digits: string[] = [];
  for (const ch of input) {
    // Permitted separators
    if (/[\s\-\u2010-\u2015]/.test(ch)) {
      continue;
    }

    const code = ch.charCodeAt(0);
    // Devanagari digits U+0966..U+096F
    if (code >= 0x0966 && code <= 0x096f) {
      digits.push(String(code - 0x0966));
    } else if (code >= 0x30 && code <= 0x39) {
      digits.push(ch);
    } else if (/\p{Nd}/u.test(ch)) {
      // Any other Unicode decimal digit
      const val = Number(ch);
      if (!Number.isNaN(val) && val >= 0 && val <= 9) {
        digits.push(String(val));
      } else {
        return {
          ok: false,
          error: {
            code: "INVALID_CHARACTERS",
            message: `Invalid character in Yen ID: "${ch}"`,
          },
        };
      }
    } else {
      return {
        ok: false,
        error: {
          code: "INVALID_CHARACTERS",
          message: `Invalid character in Yen ID: "${ch}"`,
        },
      };
    }
  }

  const raw = digits.join("");

  // 3. Length check: exactly 9 digits
  if (raw.length !== 9) {
    return {
      ok: false,
      error: {
        code: "INVALID_LENGTH",
        message: `Yen ID must be exactly 9 digits, got ${raw.length}`,
      },
    };
  }

  // 4. Leading zero check: first digit must be 1-9
  if (raw[0] === "0") {
    return {
      ok: false,
      error: {
        code: "LEADING_ZERO",
        message: "Yen ID must not start with zero",
      },
    };
  }

  // 5. Check digit validation under Damm algorithm
  if (!validateDammCheckDigit(raw)) {
    return {
      ok: false,
      error: {
        code: "INVALID_CHECK_DIGIT",
        message: "Invalid check digit in Yen ID",
      },
    };
  }

  return {
    ok: true,
    value: raw as YenId,
  };
}
