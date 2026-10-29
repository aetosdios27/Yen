import type { DeliveryChannel, DeliveryProvider } from "@yen/shared";
import { type Paise, paise } from "@yen/shared";
import type { DeliveryResult } from "../types.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";

/** Adapts the common OTP/outbox provider contract to the worker's cost-aware API. */
export class DeliveryChannelBridge implements ChannelProvider {
  constructor(
    readonly channel: DeliveryChannel,
    readonly costPerMessagePaise: Paise,
    private readonly provider: DeliveryProvider,
  ) {}

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    const params: Record<string, string> = {
      body: input.rendered.body,
      locale: input.rendered.locale,
    };
    for (const [key, value] of Object.entries(input.templateData)) {
      if (value !== undefined && value !== null) params[key] = String(value);
    }
    try {
      const response = await this.provider.send({
        channel: this.channel,
        to: input.recipientContact,
        template: input.templateId,
        params,
        idempotencyKey: input.idempotencyKey,
      });
      if (response.status === "failed") {
        return {
          success: false,
          channel: this.channel,
          cost_paise: this.costPerMessagePaise,
          error: "provider_error",
          retryable: response.idempotencyGuaranteed,
        };
      }
      return {
        success: true,
        channel: this.channel,
        cost_paise: this.costPerMessagePaise,
        provider_message_id: response.messageId,
        provider_status: response.status,
        retryable: response.idempotencyGuaranteed,
      };
    } catch {
      return {
        success: false,
        channel: this.channel,
        cost_paise: paise(0),
        error: "provider_error",
        retryable: false,
      };
    }
  }
}
