import { describe, expect, it } from "vitest";
import { validatePin } from "./rules.js";

describe("validatePin", () => {
  it("accepts strong 6-digit PINs", () => {
    expect(validatePin("482915").valid).toBe(true);
    expect(validatePin("937104").valid).toBe(true);
    expect(validatePin("719382").valid).toBe(true);
    expect(validatePin("820461").valid).toBe(true);
  });

  it("rejects non-string or non-6-digit input", () => {
    // @ts-expect-error non-string
    expect(validatePin(123456).valid).toBe(false);
    expect(validatePin("").valid).toBe(false);
    expect(validatePin("12345").valid).toBe(false);
    expect(validatePin("1234567").valid).toBe(false);
    expect(validatePin("12345a").valid).toBe(false);
    expect(validatePin("abcdef").valid).toBe(false);
    expect(validatePin(" 123456 ").valid).toBe(false);
  });

  it("refuses common PINs from blacklist", () => {
    const common = ["000000", "111111", "123456", "654321", "121212", "112233", "696969", "987654"];
    for (const pin of common) {
      const res = validatePin(pin);
      expect(res.valid).toBe(false);
    }
  });

  it("refuses repeated patterns", () => {
    // Repeated 2-digit patterns
    expect(validatePin("353535").valid).toBe(false);
    expect(validatePin("898989").valid).toBe(false);

    // Repeated 3-digit patterns
    expect(validatePin("248248").valid).toBe(false);
    expect(validatePin("713713").valid).toBe(false);

    // Three consecutive pairs
    expect(validatePin("223344").valid).toBe(false);
    expect(validatePin("778899").valid).toBe(false);
  });

  it("refuses ascending runs", () => {
    expect(validatePin("012345").valid).toBe(false);
    expect(validatePin("123456").valid).toBe(false);
    expect(validatePin("234567").valid).toBe(false);
    expect(validatePin("345678").valid).toBe(false);
    expect(validatePin("456789").valid).toBe(false);
    // Modular ascending
    expect(validatePin("789012").valid).toBe(false);
  });

  it("refuses descending runs", () => {
    expect(validatePin("654321").valid).toBe(false);
    expect(validatePin("543210").valid).toBe(false);
    expect(validatePin("987654").valid).toBe(false);
    expect(validatePin("876543").valid).toBe(false);
    // Modular descending
    expect(validatePin("210987").valid).toBe(false);
  });

  it("refuses PINs derived from user phone number", () => {
    const context = { phone: "+919876543210" };
    expect(validatePin("987654", context).valid).toBe(false);
    expect(validatePin("765432", context).valid).toBe(false);
    expect(validatePin("543210", context).valid).toBe(false);
    // Reverse
    expect(validatePin("012345", context).valid).toBe(false);
  });

  it("refuses PINs derived from user ID or Yen ID", () => {
    const context = { userId: "018f9872-4682-7890-8123-456789abcdef" };
    expect(validatePin("468278", context).valid).toBe(false);
    expect(validatePin("812345", context).valid).toBe(false);

    const yenContext = { yenId: "yen_948201_test" };
    expect(validatePin("948201", yenContext).valid).toBe(false);
  });
});
