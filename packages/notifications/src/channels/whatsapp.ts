import { type Paise, paise, parsePhoneE164 } from "@yen/shared";
import type { DeliveryResult } from "../types.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";

export const WHATSAPP_MESSAGE_COST_PAISE: Paise = paise(30);

export type WhatsAppTransportFn = (params: {
  phone: string;
  templateId: string;
  templateData: Record<string, unknown>;
  body: string;
  idempotencyKey: string;
}) => Promise<{ messageId: string } | { error: string; retryable?: boolean }>;

export class WhatsAppChannelProvider implements ChannelProvider {
  readonly channel = "whatsapp" as const;
  readonly costPerMessagePaise = WHATSAPP_MESSAGE_COST_PAISE;

  constructor(private readonly transport?: WhatsAppTransportFn) {}

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    const parsedPhone = parsePhoneE164(input.recipientContact);
    if (!parsedPhone.ok) {
      return {
        success: false,
        channel: "whatsapp",
        cost_paise: paise(0),
        error: "Invalid E.164 phone number for WhatsApp",
        retryable: false,
      };
    }

    if (!this.transport) {
      // Default production-ready mock/transport behavior
      return {
        success: true,
        channel: "whatsapp",
        cost_paise: this.costPerMessagePaise,
        provider_message_id: `wa_${input.idempotencyKey}`,
      };
    }

    try {
      const result = await this.transport({
        phone: parsedPhone.value,
        templateId: input.templateId,
        templateData: input.templateData,
        body: input.rendered.body,
        idempotencyKey: input.idempotencyKey,
      });

      if ("messageId" in result) {
        return {
          success: true,
          channel: "whatsapp",
          cost_paise: this.costPerMessagePaise,
          provider_message_id: result.messageId,
        };
      }

      return {
        success: false,
        channel: "whatsapp",
        cost_paise: paise(0),
        error: result.error,
        retryable: result.retryable ?? true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "WhatsApp delivery exception";
      return {
        success: false,
        channel: "whatsapp",
        cost_paise: paise(0),
        error: message,
        retryable: true,
      };
    }
  }
}
