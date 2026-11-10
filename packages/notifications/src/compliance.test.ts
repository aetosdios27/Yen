import { describe, expect, it } from "vitest";
import {
  buildSmsDispatchEnvelope,
  buildWhatsAppBodyParameters,
  buildWhatsAppTemplatePayload,
  renderDltRegisteredBody,
  SMS_DLT_TEMPLATE_REGISTRY,
  type SmsDispatchRegistry,
  validateSmsDispatch,
  validateWhatsAppDispatch,
  WHATSAPP_TEMPLATE_REGISTRY,
  type WhatsAppDispatchRegistry,
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

const testWhatsAppRegistry: WhatsAppDispatchRegistry = WHATSAPP_TEMPLATE_REGISTRY;

const validWhatsAppDispatch = {
  template_key: "approval_needed",
  recipient: "+919876543210",
  template_name: "yen_expense_approval_required",
  language_code: "en",
  variables: {
    expense_title: "Server hosting renewal",
    amount_inr: "Rs 1,250.00",
    fund_title: "Community Fund",
  },
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

  describe("fail-closed cases", () => {
    it("rejects a dispatch without a DLT entity ID", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, dlt_entity_id: null },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_dlt_entity_id", field: "dlt_entity_id" }),
      );
    });

    it("rejects a dispatch with a malformed DLT entity ID", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, dlt_entity_id: "ENTITY-1" },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "invalid_dlt_entity_id", field: "dlt_entity_id" }),
      );
    });

    it("rejects a dispatch without a DLT sender header", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, sender_id: undefined },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_dlt_sender_id", field: "sender_id" }),
      );
    });

    it("rejects a dispatch with a non-transactional sender header", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, sender_id: "yen42" },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "invalid_dlt_sender_id", field: "sender_id" }),
      );
    });

    it("rejects a dispatch without a DLT template ID", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, dlt_template_id: "" },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_dlt_template_id", field: "dlt_template_id" }),
      );
    });

    it("rejects a dispatch whose template ID differs from the registered ID", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, dlt_template_id: "1207160000000000002" },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "dlt_template_id_mismatch", field: "dlt_template_id" }),
      );
    });

    it("rejects template keys without a DLT registration", () => {
      const result = validateSmsDispatch(
        { ...validSmsDispatch, template_key: "weekly_summary" },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "unregistered_template", field: "template_key" }),
      );
    });

    it("rejects templates whose DLT registration is not complete yet", () => {
      const result = validateSmsDispatch(validSmsDispatch);
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: "template_registration_incomplete",
          field: "dlt_template_id",
        }),
      );
    });

    it("rejects variables outside the registered template body", () => {
      const result = validateSmsDispatch(
        {
          ...validSmsDispatch,
          variables: { code: "482913", promo: "WIN BIG" },
        },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "unapproved_variable", field: "variables.promo" }),
      );
    });

    it("rejects dispatches missing a registered variable", () => {
      const result = validateSmsDispatch(
        {
          ...validSmsDispatch,
          variables: {},
        },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_variable", field: "variables.code" }),
      );
    });

    it("rejects dispatches with an empty registered variable", () => {
      const result = validateSmsDispatch(
        {
          ...validSmsDispatch,
          variables: { code: "" },
        },
        testSmsRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "empty_variable", field: "variables.code" }),
      );
    });

    it("returns violations instead of an envelope for a non-compliant dispatch", () => {
      const result = buildSmsDispatchEnvelope(
        { ...validSmsDispatch, sender_id: "" },
        testSmsRegistry,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a rejected dispatch");
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_dlt_sender_id" }),
      );
    });
  });
});

describe("WhatsApp utility template compliance", () => {
  describe("positive cases", () => {
    it("accepts a dispatch referencing the approved template name and language", () => {
      const result = validateWhatsAppDispatch(validWhatsAppDispatch, testWhatsAppRegistry);
      expect(result.compliant).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("builds body parameters in registered positional order", () => {
      const parameters = buildWhatsAppBodyParameters(
        testWhatsAppRegistry.approval_needed,
        validWhatsAppDispatch.variables,
      );
      expect(parameters).toEqual([
        { type: "text", text: "Server hosting renewal" },
        { type: "text", text: "Rs 1,250.00" },
        { type: "text", text: "Community Fund" },
      ]);
    });

    it("builds the WhatsApp Cloud API template payload with name, language and body component", () => {
      const result = buildWhatsAppTemplatePayload(validWhatsAppDispatch, testWhatsAppRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected a compliant dispatch");
      expect(result.payload).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "+919876543210",
        type: "template",
        template: {
          name: "yen_expense_approval_required",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: "Server hosting renewal" },
                { type: "text", text: "Rs 1,250.00" },
                { type: "text", text: "Community Fund" },
              ],
            },
          ],
        },
      });
    });

    it("validates every registered WhatsApp template with its own variable set", () => {
      const sampleVariables: Record<string, Record<string, string>> = {
        otp: { code: "482913" },
        approval_needed: {
          expense_title: "Server hosting renewal",
          amount_inr: "Rs 1,250.00",
          fund_title: "Community Fund",
        },
        approved_rejected: {
          expense_title: "Server hosting renewal",
          amount_inr: "Rs 1,250.00",
          fund_title: "Community Fund",
        },
        donation_received: { amount_inr: "Rs 500.00", fund_title: "Community Fund" },
        objection_raised: {
          expense_title: "Server hosting renewal",
          fund_title: "Community Fund",
        },
      };
      for (const [templateKey, registration] of Object.entries(testWhatsAppRegistry)) {
        const result = validateWhatsAppDispatch(
          {
            template_key: templateKey,
            recipient: "+919876543210",
            template_name: registration.template_name,
            language_code: "en",
            variables: sampleVariables[templateKey],
          },
          testWhatsAppRegistry,
        );
        expect(result.compliant, templateKey).toBe(true);
        expect(result.violations, templateKey).toEqual([]);
      }
    });
  });
  describe("fail-closed cases", () => {
    it("rejects a dispatch without a template name", () => {
      const result = validateWhatsAppDispatch(
        { ...validWhatsAppDispatch, template_name: undefined },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: "missing_whatsapp_template_name",
          field: "template_name",
        }),
      );
    });

    it("rejects a dispatch whose template name differs from the approved name", () => {
      const result = validateWhatsAppDispatch(
        { ...validWhatsAppDispatch, template_name: "yen_promotional_offer" },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: "whatsapp_template_name_mismatch",
          field: "template_name",
        }),
      );
    });

    it("rejects a dispatch without a language code", () => {
      const result = validateWhatsAppDispatch(
        { ...validWhatsAppDispatch, language_code: "" },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: "missing_whatsapp_language_code",
          field: "language_code",
        }),
      );
    });

    it("rejects a language code without an approved registration", () => {
      const result = validateWhatsAppDispatch(
        { ...validWhatsAppDispatch, language_code: "hi" },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: "unapproved_language_code",
          field: "language_code",
        }),
      );
    });

    it("rejects template keys without an approved WhatsApp template", () => {
      const result = validateWhatsAppDispatch(
        { ...validWhatsAppDispatch, template_key: "fund_alert" },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "unregistered_template", field: "template_key" }),
      );
    });

    it("rejects variables outside the approved template body", () => {
      const result = validateWhatsAppDispatch(
        {
          ...validWhatsAppDispatch,
          variables: { ...validWhatsAppDispatch.variables, link: "https://example.com" },
        },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "unapproved_variable", field: "variables.link" }),
      );
    });

    it("rejects dispatches missing an approved variable", () => {
      const result = validateWhatsAppDispatch(
        {
          ...validWhatsAppDispatch,
          variables: { expense_title: "Server hosting renewal", amount_inr: "Rs 1,250.00" },
        },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "missing_variable", field: "variables.fund_title" }),
      );
    });

    it("rejects dispatches with an empty approved variable", () => {
      const result = validateWhatsAppDispatch(
        {
          ...validWhatsAppDispatch,
          variables: { ...validWhatsAppDispatch.variables, fund_title: "" },
        },
        testWhatsAppRegistry,
      );
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "empty_variable", field: "variables.fund_title" }),
      );
    });

    it("returns violations instead of a payload for a non-compliant dispatch", () => {
      const result = buildWhatsAppTemplatePayload(
        { ...validWhatsAppDispatch, language_code: "fr" },
        testWhatsAppRegistry,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a rejected dispatch");
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: "unapproved_language_code" }),
      );
    });
  });
});
