import { describe, expect, it } from "vitest";
import { computeDammCheckDigit, validateDammCheckDigit } from "./damm.js";
import { formatYenId, generateYenId, parseYenId, yenIdSchema } from "./format.js";

describe("Yen ID generation and formatting", () => {
  it("generates random valid 9-digit IDs with leading digit 1-9 and valid Damm check digit", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateYenId();
      expect(id).toMatch(/^[1-9][0-9]{8}$/);
      expect(id).toHaveLength(9);
      expect(id[0]).not.toBe("0");
      expect(validateDammCheckDigit(id)).toBe(true);
    }
  });

  it("formats 9-digit IDs into 3 groups of 3 digits separated by spaces", () => {
    expect(formatYenId("482739105")).toBe("482 739 105");
    expect(formatYenId("123456789")).toBe("123 456 789");
    expect(formatYenId("987654321")).toBe("987 654 321");
  });

  it("round-trips generated and formatted IDs through parseYenId", () => {
    for (let i = 0; i < 100; i++) {
      const original = generateYenId();
      const formatted = formatYenId(original);
      const parseResult = parseYenId(formatted);
      expect(parseResult.ok).toBe(true);
      if (parseResult.ok) {
        expect(parseResult.value).toBe(original);
      }
    }
  });

  it("accepts spaces, dashes, and tabs as separators", () => {
    const id = generateYenId();
    const g1 = id.slice(0, 3);
    const g2 = id.slice(3, 6);
    const g3 = id.slice(6, 9);

    const inputs = [
      `${g1} ${g2} ${g3}`,
      `${g1}-${g2}-${g3}`,
      ` ${g1} - ${g2} - ${g3} `,
      `${g1}\t${g2}\t${g3}`,
      `${g1}--${g2}--${g3}`,
    ];

    for (const input of inputs) {
      const result = parseYenId(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(id);
      }
    }
  });

  it("normalises Devanagari digits (U+0966-U+096F) to ASCII and validates", () => {
    // 482 739 105 in Devanagari:
    // 4=४, 8=८, 2=२, 7=७, 3=३, 9=९, 1=१, 0=०, 5=५
    // Let us verify with an actual generated valid Yen ID:
    const id = generateYenId();
    const devanagariDigits = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
    const devanagariStr = Array.from(id)
      .map((d) => devanagariDigits[Number(d)])
      .join("");

    const formattedDevanagari = `${devanagariStr.slice(0, 3)} ${devanagariStr.slice(3, 6)} ${devanagariStr.slice(6, 9)}`;

    const result = parseYenId(formattedDevanagari);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(id);
    }
  });

  it("strictly rejects letters in any position with CONTAINS_LETTERS", () => {
    const letterCases = [
      "482 739 10A",
      "a82 739 105",
      "482 b39 105",
      "482 739 10z",
      "ABC 739 105",
      "482 ७३९ १०k",
      "४८२ ७३९ १०क", // Devanagari letter 'ka'
    ];

    for (const input of letterCases) {
      const result = parseYenId(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONTAINS_LETTERS");
      }
    }
  });

  it("rejects IDs that are too short with INVALID_LENGTH", () => {
    const shortCases = ["482 739 10", "12345", "1", ""];
    for (const input of shortCases) {
      const result = parseYenId(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_LENGTH");
      }
    }
  });

  it("rejects IDs that are too long with INVALID_LENGTH", () => {
    const longCases = ["482 739 1055", "1234567890123"];
    for (const input of longCases) {
      const result = parseYenId(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_LENGTH");
      }
    }
  });

  it("strictly rejects leading zero with LEADING_ZERO", () => {
    // An 8-digit body starting with 0
    const bodyWithZero = "08273910";
    const cd = computeDammCheckDigit(bodyWithZero);
    const zeroId = `082 739 10${cd}`;

    const result = parseYenId(zeroId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LEADING_ZERO");
    }

    // Leading Devanagari zero '०'
    const devanagariZeroId = `०८२ ७३९ १०${cd}`;
    const devResult = parseYenId(devanagariZeroId);
    expect(devResult.ok).toBe(false);
    if (!devResult.ok) {
      expect(devResult.error.code).toBe("LEADING_ZERO");
    }
  });

  it("rejects invalid check digits with INVALID_CHECK_DIGIT", () => {
    const valid = generateYenId();
    const correctCheckDigit = Number(valid[8]);
    const wrongCheckDigit = (correctCheckDigit + 1) % 10;
    const tampered = `${valid.slice(0, 8)}${wrongCheckDigit}`;

    const result = parseYenId(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_CHECK_DIGIT");
    }
  });

  it("rejects punctuation and special characters other than whitespace and dash", () => {
    const badCases = ["482@739#105", "482.739.105", "482/739/105", "482+739-105"];
    for (const input of badCases) {
      const result = parseYenId(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_CHARACTERS");
      }
    }
  });
});

it("schema and parser both reject an invalid Damm check digit", () => {
  expect(yenIdSchema.safeParse("100000000").success).toBe(false);
  expect(parseYenId("100000000").ok).toBe(false);
  const valid = generateYenId();
  expect(yenIdSchema.safeParse(valid).success).toBe(true);
});
