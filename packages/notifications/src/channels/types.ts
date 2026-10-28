import type { Paise } from "@yen/shared";
import type {
  DeliveryResult,
  NotificationChannel,
  NotificationTemplateId,
  RenderedTemplate,
} from "../types.js";

export interface ChannelSendMessageInput {
  recipientContact: string;
  rendered: RenderedTemplate;
  idempotencyKey: string;
  templateId: NotificationTemplateId;
  templateData: Record<string, unknown>;
}

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  readonly costPerMessagePaise: Paise;
  send(input: ChannelSendMessageInput): Promise<DeliveryResult>;
}
