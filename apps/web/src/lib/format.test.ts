import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney } from "./format";

describe("formatMoney", () => {
  it.each([
    [0, "₹0.00"],
    [9950, "₹99.50"],
    [100000, "₹1,000.00"],
    [10000000, "₹1,00,000.00"],
    [123456700, "₹12,34,567.00"],
    [1000000000, "₹1,00,00,000.00"],
    [100000000000, "₹1,00,00,00,000.00"],
    [999999999999, "₹9,99,99,99,999.99"],
    [-5050, "-₹50.50"],
  ])("groups %i paise with the Indian digit system in both locales", (amount, expected) => {
    expect(formatMoney(paise(amount), "en")).toBe(expected);
    expect(formatMoney(paise(amount), "hi")).toBe(expected);
  });

  it("never prints a floating-point exponent", () => {
    const formatted = formatMoney(paise(123456789012), "hi");
    expect(formatted).toBe("₹1,23,45,67,890.12");
    expect(formatted).not.toMatch(/e[+-]/i);
  });
});

describe("formatDate", () => {
  const iso = "2026-10-28T10:05:00.000Z";

  it("formats in Latin digits and an abbreviated month for English", () => {
    expect(formatDate(iso, "en")).toMatch(/^\d{1,2} [A-Za-z]{3} \d{4}$/);
  });

  it("formats the month in Devanagari for Hindi", () => {
    expect(formatDate(iso, "hi")).toMatch(/^\d{1,2} [\u0900-\u097F]+ \d{4}$/);
  });

  it("keeps the Devanagari date distinct from the English one", () => {
    expect(formatDate(iso, "hi")).not.toBe(formatDate(iso, "en"));
  });

  it("returns the raw string when the date is invalid", () => {
    expect(formatDate("not-a-date", "hi")).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  const iso = "2026-10-28T10:05:00.000Z";

  it("adds hour and minute to the localized date", () => {
    expect(formatDateTime(iso, "en")).toMatch(/^\d{1,2} [A-Za-z]{3} \d{4}, \d{2}:\d{2} (am|pm)$/);
    expect(formatDateTime(iso, "hi")).toMatch(
      /^\d{1,2} [\u0900-\u097F]+ \d{4}, \d{2}:\d{2} (am|pm)$/,
    );
  });

  it("returns the raw string when the date is invalid", () => {
    expect(formatDateTime("garbage", "en")).toBe("garbage");
  });
});
