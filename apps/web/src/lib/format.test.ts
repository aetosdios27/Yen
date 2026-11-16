import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatSignedMoney, formatTime } from "./format";

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

describe("exact money options", () => {
  it.each([
    ["0", "₹0", "₹0.00"],
    ["1", "₹0.01", "₹0.01"],
    ["99", "₹0.99", "₹0.99"],
    ["100", "₹1", "₹1.00"],
    ["101", "₹1.01", "₹1.01"],
    ["-1", "-₹0.01", "-₹0.01"],
    ["-100", "-₹1", "-₹1.00"],
    ["12345678900", "₹12,34,56,789", "₹12,34,56,789.00"],
    ["900719925474099312345", "₹90,07,19,92,54,74,09,93,123.45", "₹90,07,19,92,54,74,09,93,123.45"],
  ])("formats integer paise %s without losing precision", (amount, auto, always) => {
    for (const locale of ["en", "hi"] as const) {
      for (const input of [amount, BigInt(amount)]) {
        expect(formatMoney(input, { locale, paise: "auto" })).toBe(auto);
        expect(formatMoney(input, { locale, paise: "always" })).toBe(always);
      }
    }
  });

  it.each(["", "1.1", "1e3", " 100", "+100", "NaN", "1,000"])(
    "rejects invalid wire paise %s",
    (value) => {
      expect(() => formatMoney(value)).toThrow();
    },
  );

  it("defaults to auto and handles leading zeros and negative zero", () => {
    expect(formatMoney("000100")).toBe("₹1");
    expect(formatMoney("-0")).toBe("₹0");
    expect(formatMoney(paise(100))).toBe("₹1");
  });
});

describe("signed money", () => {
  it.each([
    [0n, "+ ₹0"],
    [200000n, "+ ₹2,000"],
    [-1250000n, "− ₹12,500"],
    [-1n, "− ₹0.01"],
  ])("signs %s", (value, expected) => {
    expect(formatSignedMoney(value)).toBe(expected);
  });
  it("supports Hindi and ledger paise", () => {
    expect(formatSignedMoney("200000", { locale: "hi", paise: "always" })).toBe("+ ₹2,000.00");
  });
});

describe("dates and times in the viewer's zone", () => {
  const instant = "2026-11-15T13:42:00Z";
  it("formats the specified English date and time", () => {
    expect(formatDate(instant, { timeZone: "Asia/Kolkata" })).toBe("15 Nov 2026");
    expect(formatTime(instant, { timeZone: "Asia/Kolkata" })).toBe("7:12 pm");
  });
  it("localizes Hindi months and preserves the input", () => {
    expect(formatDate(instant, { locale: "hi", timeZone: "Asia/Kolkata" })).toBe("15 नव॰ 2026");
    expect(formatTime(instant, { locale: "hi", timeZone: "Asia/Kolkata" })).toBe("7:12 pm");
    expect(instant).toBe("2026-11-15T13:42:00Z");
  });
  it("handles midnight, noon, and a date boundary", () => {
    expect(formatTime("2026-11-15T00:00:00Z", { timeZone: "UTC" })).toBe("12:00 am");
    expect(formatTime("2026-11-15T12:00:00Z", { timeZone: "UTC" })).toBe("12:00 pm");
    expect(formatDate("2026-11-15T23:30:00Z", { timeZone: "Asia/Kolkata" })).toBe("16 Nov 2026");
    expect(formatTime("invalid")).toBe("invalid");
  });
});
