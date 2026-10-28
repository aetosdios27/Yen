import { type Paise, paise } from "@yen/shared";
import * as z from "zod";
import type { DeliveryResult } from "../types.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";

export const EMAIL_MESSAGE_COST_PAISE: Paise = paise(5);

const emailSchema = z.string().email();

export type EmailTransportFn = (params: {
  email: string;
  subject?: string | undefined;
  body: string;
  idempotencyKey: string;
}) => Promise<{ messageId: string } | { error: string; retryable?: boolean }>;

export class EmailChannelProvider implements ChannelProvider {
  readonly channel = "email" as const;
  readonly costPerMessagePaise = EMAIL_MESSAGE_COST_PAISE;

  constructor(private readonly transport?: EmailTransportFn) {}

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    const parsed = emailSchema.safeParse(input.recipientContact);
    if (!parsed.success) {
      return {
        success: false,
        channel: "email",
        cost_paise: paise(0),
        error: "Invalid email address",
        retryable: false,
      };
    }

    if (!this.transport) {
      return {
        success: true,
        channel: "email",
        cost_paise: this.costPerMessagePaise,
        provider_message_id: `email_${input.idempotencyKey}`,
      };
    }

    try {
      const result = await this.transport({
        email: parsed.data,
        subject: input.rendered.subject,
        body: input.rendered.body,
        idempotencyKey: input.idempotencyKey,
      });

      if ("messageId" in result) {
        return {
          success: true,
          channel: "email",
          cost_paise: this.costPerMessagePaise,
          provider_message_id: result.messageId,
        };
      }

      return {
        success: false,
        channel: "email",
        cost_paise: paise(0),
        error: result.error,
        retryable: result.retryable ?? true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Email delivery exception";
      return {
        success: false,
        channel: "email",
        cost_paise: paise(0),
        error: message,
        retryable: true,
      };
    }
  }
}
