import { expect, it } from "vitest";
import { paiseToRupeeString, parseRupeeString, upiIntent } from "./upi";

it.each([
  [100, "1.00"],
  [50_000, "500.00"],
  [99_999, "999.99"],
  [100_000_000, "1000000.00"],
  [5, "0.05"],
])("formats %i paise as %s", (amountPaise, expected) => {
  expect(paiseToRupeeString(amountPaise)).toBe(expected);
});

it.each([
  ["500", 50_000],
  ["750.5", 75_050],
  ["750.50", 75_050],
  ["1,299", 129_900],
  [" ₹ 99.99 ", 9_999],
])("reads %s as %i paise", (input, expected) => {
  expect(parseRupeeString(input)).toBe(expected);
});

it.each(["", "0", "0.00", "-5", "12.345", "abc", "1.2.3", "1e5", "."])("refuses %s", (input) => {
  expect(parseRupeeString(input)).toBeNull();
});

it("refuses an amount that cannot be exact", () => {
  expect(parseRupeeString("9007199254740993")).toBeNull();
});

it("builds a link with the amount and a note", () => {
  const link = upiIntent({
    upiVpa: "festival@yenbank",
    payeeName: "Festival Committee",
    amountPaise: 50_000,
    note: "Festival fund",
  });
  const url = new URL(link);

  expect(url.protocol).toBe("upi:");
  expect(url.host).toBe("pay");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    pa: "festival@yenbank",
    pn: "Festival Committee",
    cu: "INR",
    am: "500.00",
    tn: "Festival fund",
  });
});

it("leaves the amount out when the donor has not chosen one", () => {
  const url = new URL(upiIntent({ upiVpa: "festival@yenbank", payeeName: "Festival Committee" }));

  expect(url.searchParams.has("am")).toBe(false);
  expect(url.searchParams.get("pa")).toBe("festival@yenbank");
});
