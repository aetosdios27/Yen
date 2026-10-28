import { type Paise, paise } from "@yen/shared";
import type { DeliveryResult, NotificationChannel } from "../types.js";
import { EMAIL_MESSAGE_COST_PAISE } from "./email.js";
import { SMS_MESSAGE_COST_PAISE } from "./sms.js";
import type { ChannelProvider, ChannelSendMessageInput } from "./types.js";
import { WHATSAPP_MESSAGE_COST_PAISE } from "./whatsapp.js";

export interface SentNotificationRecord {
  channel: NotificationChannel;
  recipientContact: string;
  renderedBody: string;
  idempotencyKey: string;
  templateId: string;
  cost_paise: Paise;
  timestamp: Date;
}

export class InMemoryChannelProvider implements ChannelProvider {
  public sentMessages: SentNotificationRecord[] = [];
  private readonly seenIdempotencyKeys = new Map<string, DeliveryResult>();
  public shouldFail = false;
  public failureError = "Simulated channel failure";
  public failureIsRetryable = true;
  public failCount = 0; // Number of times to fail before succeeding
  private currentFailures = 0;

  constructor(
    readonly channel: NotificationChannel,
    readonly costPerMessagePaise: Paise = channel === "whatsapp"
      ? WHATSAPP_MESSAGE_COST_PAISE
      : channel === "sms"
        ? SMS_MESSAGE_COST_PAISE
        : EMAIL_MESSAGE_COST_PAISE,
  ) {}

  async send(input: ChannelSendMessageInput): Promise<DeliveryResult> {
    // Idempotency check: if we've already processed this key on this channel, return cached result
    const existing = this.seenIdempotencyKeys.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    if (this.shouldFail || (this.failCount > 0 && this.currentFailures < this.failCount)) {
      this.currentFailures++;
      const failResult: DeliveryResult = {
        success: false,
        channel: this.channel,
        cost_paise: paise(0),
        error: this.failureError,
        retryable: this.failureIsRetryable,
      };
      return failResult;
    }

    const record: SentNotificationRecord = {
      channel: this.channel,
      recipientContact: input.recipientContact,
      renderedBody: input.rendered.body,
      idempotencyKey: input.idempotencyKey,
      templateId: input.templateId,
      cost_paise: this.costPerMessagePaise,
      timestamp: new Date(),
    };

    this.sentMessages.push(record);

    const successResult: DeliveryResult = {
      success: true,
      channel: this.channel,
      cost_paise: this.costPerMessagePaise,
      provider_message_id: `${this.channel}_msg_${input.idempotencyKey}`,
    };

    this.seenIdempotencyKeys.set(input.idempotencyKey, successResult);
    return successResult;
  }

  clear() {
    this.sentMessages = [];
    this.seenIdempotencyKeys.clear();
    this.shouldFail = false;
    this.failCount = 0;
    this.currentFailures = 0;
  }
}
