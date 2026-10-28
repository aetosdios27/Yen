/**
 * Damm algorithm implementation for decimal error detection.
 *
 * The Damm algorithm uses a totally anti-symmetric quasigroup of order 10 with
 * zeros along the main diagonal (x * x = 0). It guarantees 100% detection of:
 * 1. All single-digit transcription errors (a -> b).
 * 2. All adjacent transposition errors (ab -> ba, where a != b).
 *
 * Primary Sources:
 * - H. Michael Damm, "Total anti-symmetrische Quasigruppen", Doctoral Dissertation,
 *   Philipps-Universität Marburg, 2004.
 *   URL: https://archiv.ub.uni-marburg.de/diss/z2004/0516/
 * - H. Michael Damm, "Totally anti-symmetric quasigroups for all orders n != 2, 6",
 *   Discrete Mathematics 307 (2007) 715–729.
 *   DOI: https://doi.org/10.1016/j.disc.2006.05.033
 *
 * Verified Published Test Vector:
 * Input body: 572
 * Interim reduction:
 *   c = 0
 *   d = 5 -> table[0][5] = 9
 *   d = 7 -> table[9][7] = 7
 *   d = 2 -> table[7][2] = 4
 * Check digit: 4
 * Validated payload: 5724 (table[4][4] = 0, checksum valid)
 */

/**
 * The canonical order-10 totally anti-symmetric quasigroup operation table
 * from H. Michael Damm's dissertation (2004) and paper (2007).
 */
export const DAMM_MATRIX: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
] as const;

/**
 * Computes the Damm check digit for an input sequence of digits.
 *
 * @param digits - Sequence of numeric digits (0-9) represented as numbers or an ASCII digit string.
 * @returns The check digit (0-9) such that appending it creates a sequence whose reduction is 0.
 */
export function computeDammCheckDigit(digits: readonly number[] | string): number {
  let interim = 0;
  if (typeof digits === "string") {
    for (let i = 0; i < digits.length; i++) {
      const code = digits.charCodeAt(i);
      if (code < 0x30 || code > 0x39) {
        throw new Error(`Expected ASCII decimal digit at position ${i}, got ${digits[i]}`);
      }
      const d = code - 0x30;
      const row = DAMM_MATRIX[interim];
      const val = row ? row[d] : undefined;
      if (val === undefined) {
        throw new Error(`Invalid quasigroup coordinate (${interim}, ${d})`);
      }
      interim = val;
    }
  } else {
    for (let i = 0; i < digits.length; i++) {
      const d = digits[i];
      if (typeof d !== "number" || d < 0 || d > 9 || !Number.isInteger(d)) {
        throw new Error(`Expected integer digit 0-9 at position ${i}, got ${d}`);
      }
      const row = DAMM_MATRIX[interim];
      const val = row ? row[d] : undefined;
      if (val === undefined) {
        throw new Error(`Invalid quasigroup coordinate (${interim}, ${d})`);
      }
      interim = val;
    }
  }
  return interim;
}

/**
 * Validates an entire digit sequence (body + check digit) under the Damm algorithm.
 *
 * @param digits - Complete sequence of digits including check digit.
 * @returns true if the reduction equals 0, false otherwise.
 */
export function validateDammCheckDigit(digits: readonly number[] | string): boolean {
  let interim = 0;
  if (typeof digits === "string") {
    if (digits.length === 0) return false;
    for (let i = 0; i < digits.length; i++) {
      const code = digits.charCodeAt(i);
      if (code < 0x30 || code > 0x39) {
        return false;
      }
      const d = code - 0x30;
      const row = DAMM_MATRIX[interim];
      const val = row ? row[d] : undefined;
      if (val === undefined) return false;
      interim = val;
    }
  } else {
    if (digits.length === 0) return false;
    for (let i = 0; i < digits.length; i++) {
      const d = digits[i];
      if (typeof d !== "number" || d < 0 || d > 9 || !Number.isInteger(d)) {
        return false;
      }
      const row = DAMM_MATRIX[interim];
      const val = row ? row[d] : undefined;
      if (val === undefined) return false;
      interim = val;
    }
  }
  return interim === 0;
}
