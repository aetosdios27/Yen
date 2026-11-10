import { describe, expect, it } from "vitest";
import {
  buildSmsDispatchEnvelope,
  renderDltRegisteredBody,
  SMS_DLT_TEMPLATE_REGISTRY,
  type SmsDispatchRegistry,
  validateSmsDispatch,
} from "./compliance.js";

const DLT_ENTITY_ID = "1101234567890123456";
const DLT_TEMPLATE_ID = "1207160000000000001";
const DLT_SENDER_ID = "YENTRE";

const testSmsRegistry: SmsDispatchRegistry = {
  otp: {
    ...SMS_DLT_TEMPLATE_REGISTRY.otp,
    dlt_template_id: DLT_TEMPLATE_ID,
  },
};

const validSmsDispatch = {
  template_key: "otp",
  recipient: "+919876543210",
  dlt_entity_id: DLT_ENTITY_ID,
  dlt_template_id: DLT_TEMPLATE_ID,
  sender_id: DLT_SENDER_ID,
  variables: { code: "482913" },
};

describe("SMS DLT dispatch compliance", () => {
  describe("positive cases", () => {
    it("accepts a dispatch with registered entity, sender and template identifiers", () => {
      const result = validateSmsDispatch(validSmsDispatch, testSmsRegistry);
      expect(result.compliant).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("renders the registered OTP body with the code variable", () => {
      const message = renderDltRegisteredBody(testSmsRegistry.otp, { code: "482913" });
      expect(message).toBe(
        "Your Yen club treasury login code is 482913. It is valid for 10 minutes. Do not share this code.",
      );
    });

    it("builds a dispatch envelope carrying the DLT regulatory headers", () => {
      const result = buildSmsDispatchEnvelope(validSmsDispatch, testSmsRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected a compliant dispatch");
      expect(result.envelope).toEqual({
        recipient: "+919876543210",
        sender_id: DLT_SENDER_ID,
        dlt_entity_id: DLT_ENTITY_ID,
        dlt_template_id: DLT_TEMPLATE_ID,
        message:
          "Your Yen club treasury login code is 482913. It is valid for 10 minutes. Do not share this code.",
      });
    });
  });
});
