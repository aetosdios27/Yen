import type { NotificationOutboxRow } from "@yen/db";
import type { Event } from "@yen/eventlog";
import { transactionalEnqueue, type WorkerRuntime } from "@yen/queue";
import type { FundId, UserId } from "@yen/shared";
import { EmailChannelProvider } from "./channels/email.js";
import { SmsChannelProvider } from "./channels/sms.js";
import type { ChannelProvider } from "./channels/types.js";
import { WhatsAppChannelProvider } from "./channels/whatsapp.js";
import type { DailyFundUsage } from "./cost-guard.js";
import {
  createNotificationsForEvent,
  type EventNotificationRecipient,
  enqueueNotification,
  type SqlTransaction,
} from "./outbox.js";
import type { NotificationStore } from "./store.js";
import type { EnqueueNotificationInput, UserPreferences } from "./types.js";
import type { BatchProcessingSummary, NotificationsWorker } from "./worker.js";
import { NotificationsWorker as WorkerClass } from "./worker.js";

export interface NotificationsServiceOptions {
  store: NotificationStore;
  whatsappProvider?: ChannelProvider | undefined;
  smsProvider?: ChannelProvider | undefined;
  emailProvider?: ChannelProvider | undefined;
  workerOptions?:
    | {
        batchSize?: number | undefined;
        leaseDurationMs?: number | undefined;
        backoffBaseSeconds?: number | undefined;
        clock?: (() => Date) | undefined;
      }
    | undefined;
  queueRuntime?: WorkerRuntime | undefined;
}

export class NotificationsService {
  readonly store: NotificationStore;
  readonly worker: NotificationsWorker;
  private readonly queueRuntime: WorkerRuntime | undefined;

  constructor(options: NotificationsServiceOptions) {
    this.store = options.store;
    this.queueRuntime = options.queueRuntime;
    const whatsappProvider = options.whatsappProvider ?? new WhatsAppChannelProvider();
    const smsProvider = options.smsProvider ?? new SmsChannelProvider();
    const emailProvider = options.emailProvider ?? new EmailChannelProvider();

    this.worker = new WorkerClass({
      store: this.store,
      whatsappProvider,
      smsProvider,
      emailProvider,
      batchSize: options.workerOptions?.batchSize,
      leaseDurationMs: options.workerOptions?.leaseDurationMs,
      backoffBaseSeconds: options.workerOptions?.backoffBaseSeconds,
      clock: options.workerOptions?.clock,
    });

    this.queueRuntime?.registerHandler(
      "notifications",
      async () => {
        await this.processPending();
      },
      { localConcurrency: 1, batchSize: 1 },
    );
  }

  async enqueue(
    tx: SqlTransaction,
    input: EnqueueNotificationInput,
  ): Promise<NotificationOutboxRow | null> {
    const row = await enqueueNotification(tx, input);
    if (row) await this.enqueueWakeup(tx);
    return row;
  }

  async handleEvent(
    tx: SqlTransaction,
    event: Event,
    recipients: EventNotificationRecipient[],
  ): Promise<NotificationOutboxRow[]> {
    const rows = await createNotificationsForEvent(tx, event, recipients);
    if (rows.length > 0) await this.enqueueWakeup(tx);
    return rows;
  }

  async processPending(): Promise<BatchProcessingSummary> {
    return this.worker.processNextBatch();
  }

  async getUserPreferences(userId: UserId): Promise<UserPreferences> {
    return this.store.getUserPreferences(userId);
  }

  async setUserPreferences(prefs: UserPreferences): Promise<void> {
    return this.store.setUserPreferences(prefs);
  }

  async getFundDailyUsage(fundId: FundId, date: string): Promise<DailyFundUsage> {
    return this.store.getDailyFundUsage(fundId, date);
  }

  private async enqueueWakeup(tx: SqlTransaction): Promise<void> {
    if (!this.queueRuntime) return;
    await transactionalEnqueue(
      this.queueRuntime.getBoss(),
      tx as Parameters<typeof transactionalEnqueue>[1],
      "notifications",
      { type: "outbox-ready" },
    );
  }
}
