import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeDammCheckDigit, DAMM_MATRIX, validateDammCheckDigit } from "./damm.js";

describe("Damm check digit algorithm", () => {
  it("satisfies Latin square and main diagonal properties of the quasigroup", () => {
    expect(DAMM_MATRIX).toHaveLength(10);
    for (let r = 0; r < 10; r++) {
      expect(DAMM_MATRIX[r]).toHaveLength(10);
      // Row must be a permutation of 0..9
      const rowSet = new Set(DAMM_MATRIX[r]);
      expect(rowSet.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(rowSet.has(i)).toBe(true);
      }
      // Main diagonal is 0
      expect(DAMM_MATRIX[r]![r]).toBe(0);
    }

    // Column must be a permutation of 0..9
    for (let c = 0; c < 10; c++) {
      const colSet = new Set<number>();
      for (let r = 0; r < 10; r++) {
        colSet.add(DAMM_MATRIX[r]![c]!);
      }
      expect(colSet.size).toBe(10);
    }
  });

  it("satisfies weak total anti-symmetry: (c * x) * y = (c * y) * x => x = y", () => {
    for (let c = 0; c < 10; c++) {
      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
          const c_x = DAMM_MATRIX[c]![x]!;
          const c_x_y = DAMM_MATRIX[c_x]![y]!;

          const c_y = DAMM_MATRIX[c]![y]!;
          const c_y_x = DAMM_MATRIX[c_y]![x]!;

          if (c_x_y === c_y_x) {
            expect(x).toBe(y);
          }
        }
      }
    }
  });

  it("verifies the published worked test vector 572 -> check digit 4 -> 5724 valid", () => {
    // Primary source: H. Michael Damm's dissertation and published worked example
    // Input: "572"
    // c=0, d=5 -> 9; c=9, d=7 -> 7; c=7, d=2 -> 4.
    const checkDigit = computeDammCheckDigit("572");
    expect(checkDigit).toBe(4);
    expect(computeDammCheckDigit([5, 7, 2])).toBe(4);

    // Full 4-digit sequence "5724" validates to 0
    expect(validateDammCheckDigit("5724")).toBe(true);
    expect(validateDammCheckDigit([5, 7, 2, 4])).toBe(true);

    // Any wrong check digit fails
    for (let wrong = 0; wrong < 10; wrong++) {
      if (wrong !== 4) {
        expect(validateDammCheckDigit(`572${wrong}`)).toBe(false);
      }
    }
  });

  it("proves 100% detection of all single-digit substitutions across 3,000 random 8-digit bodies", () => {
    const SAMPLE_COUNT = 3000;
    let totalSubstitutionsTested = 0;

    for (let s = 0; s < SAMPLE_COUNT; s++) {
      // Generate random 8-digit body (first digit 1-9, remaining 0-9)
      const firstDigit = randomInt(1, 10);
      const remaining = Array.from({ length: 7 }, () => randomInt(0, 10));
      const body = [firstDigit, ...remaining];
      const checkDigit = computeDammCheckDigit(body);
      const fullDigits = [...body, checkDigit];

      expect(validateDammCheckDigit(fullDigits)).toBe(true);

      // Enumerate ALL single-digit substitutions across all 9 positions
      for (let pos = 0; pos < 9; pos++) {
        const original = fullDigits[pos]!;
        for (let replacement = 0; replacement < 10; replacement++) {
          if (replacement === original) continue;

          const mutated = [...fullDigits];
          mutated[pos] = replacement;

          // Must be detected as invalid
          expect(validateDammCheckDigit(mutated)).toBe(false);
          totalSubstitutionsTested++;
        }
      }
    }

    // 3,000 * 9 positions * 9 wrong replacements = 243,000 tests
    expect(totalSubstitutionsTested).toBe(SAMPLE_COUNT * 9 * 9);
  });

  it("proves 100% detection of all adjacent transpositions across 3,000 random 8-digit bodies", () => {
    const SAMPLE_COUNT = 3000;
    let transpositionsTested = 0;

    for (let s = 0; s < SAMPLE_COUNT; s++) {
      const firstDigit = randomInt(1, 10);
      const remaining = Array.from({ length: 7 }, () => randomInt(0, 10));
      const body = [firstDigit, ...remaining];
      const checkDigit = computeDammCheckDigit(body);
      const fullDigits = [...body, checkDigit];

      expect(validateDammCheckDigit(fullDigits)).toBe(true);

      // Enumerate ALL adjacent transpositions for 8 adjacent pairs (0-1, 1-2, ..., 7-8)
      for (let pos = 0; pos < 8; pos++) {
        const a = fullDigits[pos]!;
        const b = fullDigits[pos + 1]!;

        // Note: transposition of two equal digits changes nothing and is excluded by specification
        if (a === b) continue;

        const transposed = [...fullDigits];
        transposed[pos] = b;
        transposed[pos + 1] = a;

        // Must be detected as invalid
        expect(validateDammCheckDigit(transposed)).toBe(false);
        transpositionsTested++;
      }
    }

    expect(transpositionsTested).toBeGreaterThan(0);
  });
});
