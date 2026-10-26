import { describe, expect, expectTypeOf, it } from "vitest";
import { type PhoneE164, parsePhoneE164 } from "./phone.js";

describe("parsePhoneE164", () => {
  it.each(["+919876543210", "+12345678", "+123456789012345"])(
    "accepts canonical E.164 %s",
    (input) => expect(parsePhoneE164(input)).toEqual({ ok: true, value: input }),
  );

  it.each([
    "9876543210",
    "+0123456789",
    "+91 98765 43210",
    "+91-9876543210",
    "",
    "+1234567890123456",
    null,
    919876543210,
  ])("rejects noncanonical input %j", (input) => {
    expect(parsePhoneE164(input)).toEqual({ ok: false, error: "Expected canonical E.164 phone" });
  });

  it("keeps the phone brand distinct from string", () => {
    expectTypeOf<string>().not.toExtend<PhoneE164>();
  });
});
