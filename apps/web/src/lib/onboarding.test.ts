import { expect, it } from "vitest";
import { isApproverContact, isCanonicalPaise, isUpiVpa, whatsappInviteLink } from "./onboarding";

it("accepts canonical integer paise only", () => {
  expect(isCanonicalPaise("12500")).toBe(true);
  expect(isCanonicalPaise("12.50")).toBe(false);
  expect(isCanonicalPaise("012")).toBe(false);
});

it("validates UPI and trustee contacts", () => {
  expect(isUpiVpa("club@upi")).toBe(true);
  expect(isUpiVpa("not-a-vpa")).toBe(false);
  expect(isApproverContact("trustee@example.org")).toBe(true);
  expect(isApproverContact("+919876543210")).toBe(true);
});

it("creates a bilingual WhatsApp share URL", () => {
  expect(
    decodeURIComponent(whatsappInviteLink("https://yen.example/invites/a", "River Club")),
  ).toContain("अपने क्लब");
});
