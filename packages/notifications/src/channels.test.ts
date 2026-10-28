import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { EMAIL_MESSAGE_COST_PAISE, EmailChannelProvider } from "./channels/email.js";
import { InMemoryChannelProvider } from "./channels/in-memory.js";
import { SMS_MESSAGE_COST_PAISE, SmsChannelProvider } from "./channels/sms.js";
import { WHATSAPP_MESSAGE_COST_PAISE, WhatsAppChannelProvider } from "./channels/whatsapp.js";

describe("Channel Providers", () => {
  const dummyRendered = {
    subject: "Test Subject",
    body: "Test Body Message",
    locale: "en" as const,
  };

  describe("WhatsAppChannelProvider", () => {
    it("delivers with 30 paise cost when valid E.164 phone is provided", async () => {
      const provider = new WhatsAppChannelProvider();
      expect(provider.costPerMessagePaise).toEqual(WHATSAPP_MESSAGE_COST_PAISE);

      const result = await provider.send({
        recipientContact: "+919876543210",
        rendered: dummyRendered,
        idempotencyKey: "test-wa-1",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(true);
      expect(result.channel).toBe("whatsapp");
      expect(result.cost_paise).toEqual(paise(30));
      expect(result.provider_message_id).toBe("wa_test-wa-1");
    });

    it("rejects non-E.164 phone number without charging cost", async () => {
      const provider = new WhatsAppChannelProvider();
      const result = await provider.send({
        recipientContact: "9876543210", // Missing +91
        rendered: dummyRendered,
        idempotencyKey: "test-wa-invalid",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(false);
      expect(result.cost_paise).toEqual(paise(0));
      expect(result.error).toContain("Invalid E.164 phone");
      expect(result.retryable).toBe(false);
    });

    it("invokes transport and catches errors", async () => {
      const provider = new WhatsAppChannelProvider(async () => {
        return { error: "Recipient not on WhatsApp", retryable: false };
      });

      const result = await provider.send({
        recipientContact: "+919876543210",
        rendered: dummyRendered,
        idempotencyKey: "test-wa-error",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Recipient not on WhatsApp");
      expect(result.retryable).toBe(false);
    });
  });

  describe("SmsChannelProvider", () => {
    it("delivers with 15 paise cost when valid E.164 phone is provided", async () => {
      const provider = new SmsChannelProvider();
      expect(provider.costPerMessagePaise).toEqual(SMS_MESSAGE_COST_PAISE);

      const result = await provider.send({
        recipientContact: "+919876543210",
        rendered: dummyRendered,
        idempotencyKey: "test-sms-1",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(true);
      expect(result.channel).toBe("sms");
      expect(result.cost_paise).toEqual(paise(15));
      expect(result.provider_message_id).toBe("sms_test-sms-1");
    });

    it("rejects invalid phone without charging cost", async () => {
      const provider = new SmsChannelProvider();
      const result = await provider.send({
        recipientContact: "invalid-phone",
        rendered: dummyRendered,
        idempotencyKey: "test-sms-invalid",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(false);
      expect(result.cost_paise).toEqual(paise(0));
    });
  });

  describe("EmailChannelProvider", () => {
    it("delivers with 5 paise cost when valid email is provided", async () => {
      const provider = new EmailChannelProvider();
      expect(provider.costPerMessagePaise).toEqual(EMAIL_MESSAGE_COST_PAISE);

      const result = await provider.send({
        recipientContact: "user@example.com",
        rendered: dummyRendered,
        idempotencyKey: "test-email-1",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(true);
      expect(result.channel).toBe("email");
      expect(result.cost_paise).toEqual(paise(5));
      expect(result.provider_message_id).toBe("email_test-email-1");
    });

    it("rejects invalid email address without charging cost", async () => {
      const provider = new EmailChannelProvider();
      const result = await provider.send({
        recipientContact: "not-an-email",
        rendered: dummyRendered,
        idempotencyKey: "test-email-invalid",
        templateId: "approval_needed",
        templateData: {},
      });

      expect(result.success).toBe(false);
      expect(result.cost_paise).toEqual(paise(0));
    });
  });

  describe("InMemoryChannelProvider", () => {
    it("deduplicates sends by idempotencyKey", async () => {
      const provider = new InMemoryChannelProvider("whatsapp");

      const input = {
        recipientContact: "+919876543210",
        rendered: dummyRendered,
        idempotencyKey: "idem-key-1",
        templateId: "approval_needed" as const,
        templateData: {},
      };

      const res1 = await provider.send(input);
      expect(res1.success).toBe(true);
      expect(provider.sentMessages).toHaveLength(1);

      // Sending again with the exact same idempotencyKey returns cached response without duplicate send
      const res2 = await provider.send(input);
      expect(res2.success).toBe(true);
      expect(res2.provider_message_id).toBe(res1.provider_message_id);
      expect(provider.sentMessages).toHaveLength(1);
    });

    it("supports simulated failures", async () => {
      const provider = new InMemoryChannelProvider("sms");
      provider.shouldFail = true;
      provider.failureError = "Carrier network timeout";

      const res = await provider.send({
        recipientContact: "+919876543210",
        rendered: dummyRendered,
        idempotencyKey: "idem-key-fail",
        templateId: "approval_needed" as const,
        templateData: {},
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Carrier network timeout");
      expect(provider.sentMessages).toHaveLength(0);
    });
  });
});
