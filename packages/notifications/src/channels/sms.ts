import { type Paise, paise, parsePhoneE164 } from "@yen/shared";
import type { DeliveryResult } from "../types.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";

export const SMS_MESSAGE_COST_PAISE: Paise = paise(15);

export type SmsTransportFn = (params: {
  phone: string;
  body: string;
  idempotencyKey: string;
}) => Promise<{ messageId: string } | { error: string; retryable?: boolean }>;

export class SmsChannelProvider implements ChannelProvider {
  readonly channel = "sms" as const;
  readonly costPerMessagePaise = SMS_MESSAGE_COST_PAISE;

  constructor(private readonly transport?: SmsTransportFn) {}

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    const parsedPhone = parsePhoneE164(input.recipientContact);
    if (!parsedPhone.ok) {
      return {
        success: false,
        channel: "sms",
        cost_paise: paise(0),
        error: "Invalid E.164 phone number for SMS",
        retryable: false,
      };
    }

    if (!this.transport) {
      return {
        success: true,
        channel: "sms",
        cost_paise: this.costPerMessagePaise,
        provider_message_id: `sms_${input.idempotencyKey}`,
      };
    }

    try {
      const result = await this.transport({
        phone: parsedPhone.value,
        body: input.rendered.body,
        idempotencyKey: input.idempotencyKey,
      });

      if ("messageId" in result) {
        return {
          success: true,
          channel: "sms",
          cost_paise: this.costPerMessagePaise,
          provider_message_id: result.messageId,
        };
      }

      return {
        success: false,
        channel: "sms",
        cost_paise: paise(0),
        error: result.error,
        retryable: result.retryable ?? true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "SMS delivery exception";
      return {
        success: false,
        channel: "sms",
        cost_paise: paise(0),
        error: message,
        retryable: true,
      };
    }
  }
}
