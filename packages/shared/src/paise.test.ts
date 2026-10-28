import { describe, expect, it } from "vitest";
import { addPaise, formatInr, paise, toPaise } from "./paise.js";

describe("paise", () => {
  it("accepts integers", () => {
    expect(paise(12_345)).toBe(12_345);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (bad) => {
    expect(() => paise(bad)).toThrow(RangeError);
  });

  it("adds without producing floats", () => {
    expect(addPaise(paise(10), paise(20))).toBe(30);
  });
});

describe("toPaise", () => {
  it.each([
    [0, 0],
    [10, 1000],
    [10.5, 1050],
    [1.14, 114],
    [-25.5, -2550],
    ["0", 0],
    ["10", 1000],
    ["10.5", 1050],
    ["10.50", 1050],
    ["0.05", 5],
    ["₹100.50", 10050],
    ["1,234.56", 123456],
    ["₹12,34,567.89", 123456789],
    ["-10.50", -1050],
  ])("converts %s to %i paise", (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "10.999", "10.5.5", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid input %s",
    (bad) => {
      expect(() => toPaise(bad as string | number)).toThrow(RangeError);
    },
  );
});

describe("formatInr", () => {
  it.each([
    [0, "₹0.00"],
    [5, "₹0.05"],
    [100, "₹1.00"],
    [123_456_789, "₹12,34,567.89"],
    [-250_050, "-₹2,500.50"],
  ])("formats %i as %s", (value, expected) => {
    expect(formatInr(paise(value))).toBe(expected);
  });
});
