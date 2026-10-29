import { ResilientCall, type Paise, paise, parsePhoneE164 } from "@yen/shared";
import type { DeliveryResult } from "../types.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";

export interface ExotelSmsConfig {
  endpoint: string;
  apiKey: string;
  apiToken: string;
  senderId: string;
  entityId: string;
  templateId: string;
  timeoutMs?: number;
}

export class ExotelSmsProvider implements ChannelProvider {
  readonly channel = "sms" as const;
  readonly costPerMessagePaise: Paise = paise(0);
  private readonly resilient = new ResilientCall({
    timeoutMs: 10_000,
    maxAttempts: 1,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    failureThreshold: 5,
    resetAfterMs: 60_000,
  });

  constructor(
    private readonly config: ExotelSmsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") {
      throw new Error("SMS gateway endpoint must use HTTPS");
    }
    if (!config.apiKey || !config.apiToken || !config.senderId || !config.entityId || !config.templateId) {
      throw new Error("SMS gateway configuration is incomplete");
    }
  }

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    const phone = parsePhoneE164(input.recipientContact);
    if (!phone.ok) return { success: false, channel: "sms", cost_paise: paise(0), error: "Invalid recipient", retryable: false };
    const body = new URLSearchParams({
      From: this.config.senderId,
      To: phone.value,
      Body: input.rendered.body,
      DltEntityId: this.config.entityId,
      DltTemplateId: this.config.templateId,
      CustomField: input.idempotencyKey,
    });
    try {
      const response = await this.resilient.run(
        () =>
          this.fetcher(this.config.endpoint, {
            method: "POST",
            headers: {
              authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiToken}`).toString("base64")}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body,
            signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
          }),
        // Exotel does not document idempotency for sends, so ambiguous failure is one attempt.
        { maxAttempts: 1 },
      );
      if (!response.ok) return { success: false, channel: "sms", cost_paise: paise(0), error: "SMS gateway rejected request", retryable: false };
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("SMSMessage" in payload)) {
        return { success: false, channel: "sms", cost_paise: paise(0), error: "Malformed SMS gateway response", retryable: false };
      }
      const message = (payload as { SMSMessage?: { Sid?: unknown } }).SMSMessage;
      if (typeof message?.Sid !== "string" || message.Sid.length === 0) {
        return { success: false, channel: "sms", cost_paise: paise(0), error: "Malformed SMS gateway response", retryable: false };
      }
      return { success: true, channel: "sms", cost_paise: this.costPerMessagePaise, provider_message_id: message.Sid };
    } catch {
      // The gateway does not document request idempotency. Treat transport errors as ambiguous.
      return { success: false, channel: "sms", cost_paise: paise(0), error: "Ambiguous SMS gateway failure", retryable: false };
    }
  }
}
