import type { NotificationOutboxRow } from "@yen/db";
import { parseFundId, parseUserId } from "@yen/shared";
import type { ChannelProvider } from "./channels/types.js";
import { checkDailyCap, getTodayDateString } from "./cost-guard.js";
import { calculateQuietHoursEnd, getEligibleChannels, isDuringQuietHours } from "./preferences.js";
import type { NotificationStore } from "./store.js";
import { renderNotificationTemplate } from "./templates.js";
import type { NotificationChannel, RenderedTemplate } from "./types.js";

export interface NotificationsWorkerOptions {
  store: NotificationStore;
  whatsappProvider: ChannelProvider;
  smsProvider: ChannelProvider;
  emailProvider?: ChannelProvider | undefined;
  leaseDurationMs?: number | undefined;
  batchSize?: number | undefined;
  backoffBaseSeconds?: number | undefined;
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
  private readonly clock: () => Date;
  private readonly logger: NotificationsWorkerOptions["logger"];

  constructor(options: NotificationsWorkerOptions) {
    this.store = options.store;
    this.whatsappProvider = options.whatsappProvider;
    this.smsProvider = options.smsProvider;
    this.emailProvider = options.emailProvider;
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.batchSize = options.batchSize ?? 20;
    this.backoffBaseSeconds = options.backoffBaseSeconds ?? 5;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
  }

  async processNextBatch(): Promise<BatchProcessingSummary> {
    const now = this.clock();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);

    const rows = await this.store.claimBatch(this.batchSize, leaseExpiresAt, now);

    const summary: BatchProcessingSummary = {
      claimed: rows.length,
      delivered: 0,
      failed: 0,
      skipped: 0,
      deadLettered: 0,
    };

    for (const row of rows) {
      const result = await this.processNotification(row, now);
      switch (result) {
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
  ): Promise<"delivered" | "failed" | "skipped" | "dead_letter"> {
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

    for (const channel of eligibleChannels) {
      const provider = this.getProvider(channel);
      if (!provider) continue;

      const recipientContact = channel === "email" ? contact.email : contact.phone;
      if (!recipientContact) continue;

      if (!(await this.store.ownsClaim(row.id, claimToken, now))) {
        this.logger?.warn("Notification delivery stopped after claim was replaced", {
          notification_id: row.id,
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
        // Record delivery and cost
        const claimedByThisWorker = await this.store.markDelivered(
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
        await this.store.incrementFundUsage(fundId, today, deliveryResult.cost_paise);

        this.logger?.info("Notification successfully delivered", {
          notification_id: row.id,
          fund_id: fundId,
          channel,
          cost_paise: deliveryResult.cost_paise,
        });

        delivered = true;
        break;
      }

      // Keep provider details out of logs because they can contain recipient data.
      lastError = deliveryResult.error ?? `Failure on channel ${channel}`;
      this.logger?.warn("Channel delivery failed", {
        notification_id: row.id,
        channel,
        error: "provider_error",
      });
    }

    if (delivered) {
      return "delivered";
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
    const delaySeconds = this.backoffBaseSeconds * 2 ** Math.max(0, row.attempts - 1);
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
