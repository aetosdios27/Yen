import type { NotificationOutboxRow } from "@yen/db";
import type { DeliveryProvider } from "@yen/shared";
import { parseFundId, parseUserId } from "@yen/shared";
import { DeliveryChannelBridge } from "./channels/delivery-bridge.js";
import { SMS_MESSAGE_COST_PAISE } from "./channels/sms.js";
import type { ChannelProvider } from "./channels/types.js";
import { WHATSAPP_MESSAGE_COST_PAISE } from "./channels/whatsapp.js";
import { checkDailyCap, getTodayDateString } from "./cost-guard.js";
import {
  calculateQuietHoursEnd,
  getEligibleChannels,
  isChannelEnabled,
  isDuringQuietHours,
} from "./preferences.js";
import type { NotificationStore } from "./store.js";
import { renderNotificationTemplate } from "./templates.js";
import type { NotificationChannel, RenderedTemplate } from "./types.js";

export interface NotificationsWorkerOptions {
  store: NotificationStore;
  deliveryProviders?: Readonly<Record<"whatsapp" | "sms", DeliveryProvider>> | undefined;
  whatsappProvider?: ChannelProvider | undefined;
  smsProvider?: ChannelProvider | undefined;
  emailProvider?: ChannelProvider | undefined;
  leaseDurationMs?: number | undefined;
  batchSize?: number | undefined;
  backoffBaseSeconds?: number | undefined;
  random?: (() => number) | undefined;
  clock?: (() => Date) | undefined;
  logger?:
    | {
        info: (msg: string, meta?: Record<string, unknown>) => void;
        warn: (msg: string, meta?: Record<string, unknown>) => void;
        error: (msg: string, meta?: Record<string, unknown>) => void;
      }
    | undefined;
}

export interface BatchProcessingSummary {
  claimed: number;
  submitted: number;
  delivered: number;
  failed: number;
  skipped: number;
  deadLettered: number;
}

export class NotificationsWorker {
  private readonly store: NotificationStore;
  private readonly whatsappProvider: ChannelProvider;
  private readonly smsProvider: ChannelProvider;
  private readonly emailProvider: ChannelProvider | undefined;
  private readonly leaseDurationMs: number;
  private readonly batchSize: number;
  private readonly backoffBaseSeconds: number;
  private readonly random: () => number;
  private readonly clock: () => Date;
  private readonly logger: NotificationsWorkerOptions["logger"];

  constructor(options: NotificationsWorkerOptions) {
    this.store = options.store;
    const whatsappProvider =
      options.whatsappProvider ??
      (options.deliveryProviders
        ? new DeliveryChannelBridge(
            "whatsapp",
            WHATSAPP_MESSAGE_COST_PAISE,
            options.deliveryProviders.whatsapp,
          )
        : undefined);
    const smsProvider =
      options.smsProvider ??
      (options.deliveryProviders
        ? new DeliveryChannelBridge("sms", SMS_MESSAGE_COST_PAISE, options.deliveryProviders.sms)
        : undefined);
    if (!whatsappProvider) throw new Error("WhatsApp delivery provider is required");
    if (!smsProvider) throw new Error("SMS delivery provider is required");
    this.whatsappProvider = whatsappProvider;
    this.smsProvider = smsProvider;
    this.emailProvider = options.emailProvider;
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.batchSize = options.batchSize ?? 20;
    this.backoffBaseSeconds = options.backoffBaseSeconds ?? 5;
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
  }

  async processNextBatch(): Promise<BatchProcessingSummary> {
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);

    const rows = await this.store.claimBatch(this.batchSize, leaseExpiresAt, now);

    const summary: BatchProcessingSummary = {
      claimed: rows.length,
      submitted: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
      deadLettered: 0,
    };

    for (const row of rows) {
      const result = await this.processNotification(row, now);
      switch (result) {
        case "submitted":
          summary.submitted++;
          break;
        case "delivered":
          summary.delivered++;
          break;
        case "failed":
          summary.failed++;
          break;
        case "skipped":
          summary.skipped++;
          break;
        case "dead_letter":
          summary.deadLettered++;
          break;
      }
    }

    return summary;
  }

  async processNotification(
    row: NotificationOutboxRow,
    now: Date = this.clock(),
  ): Promise<"submitted" | "delivered" | "failed" | "skipped" | "dead_letter"> {
    const claimToken = row.claim_token;
    if (!claimToken) {
      throw new Error("Claimed notification is missing its fencing token");
    }

    const parsedFund = parseFundId(row.fund_id);
    const parsedUser = parseUserId(row.user_id);

    if (!parsedFund.ok || !parsedUser.ok) {
      await this.store.markDeadLetter(
        row.id,
        claimToken,
        "Corrupted notification row: invalid fund or user ID",
        now,
      );
      return "dead_letter";
    }

    const fundId = parsedFund.value;
    const userId = parsedUser.value;

    // 1. Check user preferences & opt-out
    const preferences = await this.store.getUserPreferences(userId);
    if (preferences.opted_out) {
      await this.store.markSkipped(row.id, claimToken, "User opted out of all notifications", now);
      this.logger?.info("Notification skipped: user opted out", {
        notification_id: row.id,
        fund_id: fundId,
      });
      return "skipped";
    }
    if (!isChannelEnabled(preferences, row.preferred_channel)) {
      await this.store.markSkipped(
        row.id,
        claimToken,
        "User opted out of this notification channel",
        now,
      );
      this.logger?.info("Notification skipped: channel disabled", {
        notification_id: row.id,
        fund_id: fundId,
      });
      return "skipped";
    }

    // 2. Check quiet hours
    if (isDuringQuietHours(preferences, now)) {
      const quietHoursEnd = calculateQuietHoursEnd(preferences, now);
      await this.store.reschedule(row.id, claimToken, quietHoursEnd, true, now);
      this.logger?.info("Notification postponed due to quiet hours", {
        notification_id: row.id,
        fund_id: fundId,
        rescheduled_to: quietHoursEnd.toISOString(),
      });
      return "skipped";
    }

    // 3. Cost guard: Check fund daily cap
    const today = getTodayDateString(now, preferences.timezone);
    const dailyUsage = await this.store.getDailyFundUsage(fundId, today);
    const capCheck = checkDailyCap(dailyUsage);
    if (!capCheck.allowed) {
      const errorMsg = capCheck.reason ?? "Daily notification cap exceeded for fund";
      // Cap is per day, retry next day or fail
      const nextAttemptAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later
      await this.store.markFailed(row.id, claimToken, errorMsg, nextAttemptAt, now);
      this.logger?.warn("Notification blocked by cost guard: daily cap reached", {
        notification_id: row.id,
        fund_id: fundId,
        sent_count: dailyUsage.sent_count,
        cap_count: dailyUsage.cap_count,
      });
      return "failed";
    }

    // 4. Retrieve recipient contact
    const contact = await this.store.getUserContact(userId);
    if (!contact || (!contact.phone && !contact.email)) {
      await this.store.markDeadLetter(
        row.id,
        claimToken,
        "Recipient has no contact information on file",
        now,
      );
      return "dead_letter";
    }

    // 5. Render notification template
    let rendered: RenderedTemplate;
    try {
      rendered = renderNotificationTemplate(row.template_id, row.template_data, preferences.locale);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Template render error";
      await this.store.markDeadLetter(row.id, claimToken, `Template error: ${errMsg}`, now);
      return "dead_letter";
    }

    // 6. Resolve eligible channels
    const eligibleChannels = getEligibleChannels(preferences, row.preferred_channel);
    if (eligibleChannels.length === 0) {
      await this.store.markSkipped(
        row.id,
        claimToken,
        "No delivery channels enabled in user preferences",
        now,
      );
      return "skipped";
    }

    // 7. Deliver only through the user's selected channel.
    let lastError = "Delivery failed across all channels";
    let delivered = false;
    let retrySafe = true;

    for (const channel of eligibleChannels) {
      const provider = this.getProvider(channel);
      if (!provider) continue;

      const recipientContact = channel === "email" ? contact.email : contact.phone;
      if (!recipientContact) continue;

      const currentPreferences = await this.store.getUserPreferences(userId);
      if (currentPreferences.opted_out || !isChannelEnabled(currentPreferences, channel)) {
        await this.store.markSkipped(
          row.id,
          claimToken,
          "User withdrew consent before delivery",
          now,
        );
        this.logger?.info("Notification skipped: consent withdrawn before delivery", {
          notification_id: row.id,
          fund_id: fundId,
        });
        return "skipped";
      }

      if (!(await this.store.ownsClaim(row.id, claimToken, now))) {
        this.logger?.warn("Notification delivery stopped after claim was replaced", {
          notification_id: row.id,
        });
        return "failed";
      }
      const sendPreparation = await this.store.prepareSend({
        notificationId: row.id,
        claimToken,
        fundId,
        date: today,
        costPaise: provider.costPerMessagePaise,
        now,
      });
      if (sendPreparation === "claim_lost") {
        this.logger?.warn("Notification send stopped after claim was replaced", {
          notification_id: row.id,
        });
        return "failed";
      }
      if (sendPreparation === "cap_reached") {
        await this.store.markFailed(
          row.id,
          claimToken,
          "Daily notification cap reached",
          new Date(now.getTime() + 24 * 60 * 60 * 1000),
          now,
        );
        this.logger?.warn("Notification blocked by cost guard: daily cap reached", {
          notification_id: row.id,
          fund_id: fundId,
        });
        return "failed";
      }

      const channelIdempotencyKey = row.idempotency_key;

      const deliveryResult = await provider.send({
        recipientContact,
        rendered,
        idempotencyKey: channelIdempotencyKey,
        templateId: row.template_id,
        templateData: (row.template_data ?? {}) as Record<string, unknown>,
      });

      if (deliveryResult.success) {
        const accepted = deliveryResult.provider_status === "accepted";
        const claimedByThisWorker =
          accepted && deliveryResult.provider_message_id
            ? await this.store.markSubmitted(
                row.id,
                claimToken,
                channel,
                deliveryResult.cost_paise,
                deliveryResult.provider_message_id,
                now,
              )
            : await this.store.markDelivered(
                row.id,
                claimToken,
                channel,
                deliveryResult.cost_paise,
                now,
              );
        if (!claimedByThisWorker) {
          this.logger?.warn("Notification result ignored after claim was replaced", {
            notification_id: row.id,
          });
          return "failed";
        }

        this.logger?.info(
          accepted ? "Notification accepted by provider" : "Notification delivered",
          {
            notification_id: row.id,
            fund_id: fundId,
            channel,
            cost_paise: deliveryResult.cost_paise,
          },
        );

        delivered = true;
        if (accepted) retrySafe = false;
        break;
      }

      // Keep provider details out of logs because they can contain recipient data.
      lastError = "provider_error";
      retrySafe = deliveryResult.retryable === true;
      this.logger?.warn("Channel delivery failed", {
        notification_id: row.id,
        channel,
        error: "provider_error",
      });
    }

    if (delivered) {
      return retrySafe ? "delivered" : "submitted";
    }

    // A provider can accept a send and then time out before returning its ID.
    // If it does not promise idempotency, never send that outbox row again.
    if (!retrySafe) {
      await this.store.markDeadLetter(
        row.id,
        claimToken,
        "Ambiguous provider result; automatic retry suppressed",
        now,
      );
      this.logger?.error(
        "Notification moved to dead-letter queue after ambiguous provider result",
        {
          notification_id: row.id,
          fund_id: fundId,
          attempts: row.attempts,
          error: "ambiguous_provider_result",
        },
      );
      return "dead_letter";
    }

    // If all channels failed
    if (row.attempts >= row.max_attempts) {
      await this.store.markDeadLetter(row.id, claimToken, lastError, now);
      this.logger?.error("Notification moved to dead-letter queue", {
        notification_id: row.id,
        fund_id: fundId,
        attempts: row.attempts,
        error: "provider_error",
      });
      return "dead_letter";
    }

    // Schedule retry with exponential backoff
    const delayCapSeconds = this.backoffBaseSeconds * 2 ** Math.max(0, row.attempts - 1);
    const delaySeconds = Math.floor(delayCapSeconds * this.random());
    const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);
    await this.store.markFailed(row.id, claimToken, lastError, nextAttemptAt, now);

    this.logger?.warn("Notification delivery failed, scheduled retry", {
      notification_id: row.id,
      fund_id: fundId,
      attempts: row.attempts,
      retry_at: nextAttemptAt.toISOString(),
      error: "provider_error",
    });

    return "failed";
  }

  private getProvider(channel: NotificationChannel): ChannelProvider | undefined {
    switch (channel) {
      case "whatsapp":
        return this.whatsappProvider;
      case "sms":
        return this.smsProvider;
      case "email":
        return this.emailProvider;
    }
  }
}
