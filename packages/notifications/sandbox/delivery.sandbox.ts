import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExotelSmsProvider } from "../src/channels/exotel-sms.js";
import { WhatsAppCloudProvider } from "../src/channels/whatsapp-cloud.js";
import { loadSandboxConfig } from "../src/sandbox-config.js";

const config = loadSandboxConfig(process.env);

describe.skipIf(config === null)("provider sandbox login code acceptance", () => {
  it.each(["whatsapp", "sms"] as const)("accepts a real %s code", async (channel) => {
    if (!config) throw new Error("Delivery sandbox is disabled");
    const provider =
      channel === "whatsapp"
        ? new WhatsAppCloudProvider(config.whatsapp)
        : new ExotelSmsProvider(config.sms);
    const response = await provider.send({
      channel,
      to: config.phone,
      template: "otp",
      params: { code: randomInt(100_000, 1_000_000).toString(), locale: "en" },
      idempotencyKey: `sandbox:${randomUUID()}`,
    });
    expect(response.status).toBe("accepted");
    expect(response.messageId.length > 0).toBe(true);
  });
});
