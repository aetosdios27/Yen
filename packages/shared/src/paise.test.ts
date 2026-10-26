import { describe, expect, it } from "vitest";
import { addPaise, formatInr, paise } from "./paise.js";

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
