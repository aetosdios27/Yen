import { type DeliveryProvider, paise } from "@yen/shared";
import { expect, it } from "vitest";
import { DeliveryChannelBridge } from "./delivery-bridge.js";

const message = {
  recipientContact: "+919876543210",
  rendered: { body: "Fake notification", locale: "en" as const },
  idempotencyKey: "bridge-test-key",
  templateId: "donation_received" as const,
  templateData: { fund_title: "Test fund" },
};

it("maps terminal provider failure to a safe worker failure result", async () => {
  const provider: DeliveryProvider = {
    async send() {
      return { messageId: "sms.fake", status: "failed", idempotencyGuaranteed: true };
    },
  };
  const bridge = new DeliveryChannelBridge("sms", paise(15), provider);

  await expect(bridge.send(message)).resolves.toMatchObject({
    success: false,
    error: "provider_error",
    retryable: true,
  });
});

it("does not expose a thrown provider error or mark it retryable", async () => {
  const provider: DeliveryProvider = {
    async send() {
      throw new Error("private phone and code");
    },
  };
  const bridge = new DeliveryChannelBridge("sms", paise(15), provider);

  const result = await bridge.send(message);

  expect(result.success).toBe(false);
  expect(result.error).toBe("provider_error");
  expect(result.retryable).toBe(false);
});
