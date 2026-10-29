import type {
  FundNotificationDailyUsageRow,
  NotificationDeadLetterRow,
  NotificationOutboxRow,
} from "@yen/db";
import { uuidv7 } from "@yen/db";
import { addPaise, type FundId, type Paise, paise, type UserId } from "@yen/shared";
import { type DailyFundUsage, DEFAULT_DAILY_NOTIFICATION_CAP } from "./cost-guard.js";
import type { SqlTransaction } from "./outbox.js";
import { getDefaultUserPreferences } from "./preferences.js";
import type { NotificationChannel, UserPreferences } from "./types.js";

export interface RecipientContactInfo {
  phone?: string;
  email?: string;
}

export interface NotificationStore {
  claimBatch(batchSize: number, leaseExpiresAt: Date, now?: Date): Promise<NotificationOutboxRow[]>;
  ownsClaim(id: string, claimToken: string, now?: Date): Promise<boolean>;
  prepareSend(input: {
    notificationId: string;
    claimToken: string;
    fundId: FundId;
    date: string;
    costPaise: Paise;
    now: Date;
  }): Promise<"prepared" | "cap_reached" | "claim_lost">;

  markDelivered(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    now?: Date,
  ): Promise<boolean>;

  markSubmitted(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    providerMessageId: string,
    now?: Date,
  ): Promise<boolean>;
  applyDeliveryStatus(
    provider: "meta_whatsapp" | "exotel_sms",
    providerMessageId: string,
    status: "delivered" | "dead_letter",
    eventKey: string,
    occurredAt?: Date | null,
    now?: Date,
  ): Promise<boolean>;

  markFailed(
    id: string,
    claimToken: string,
    error: string,
    nextAttemptAt: Date,
    now?: Date,
  ): Promise<void>;

  markDeadLetter(id: string, claimToken: string, error: string, now?: Date): Promise<void>;

  markSkipped(id: string, claimToken: string, reason: string, now?: Date): Promise<void>;

  reschedule(
    id: string,
    claimToken: string,
    nextAttemptAt: Date,
    decrementAttempt?: boolean,
    now?: Date,
  ): Promise<void>;

  getUserPreferences(userId: UserId): Promise<UserPreferences>;
  setUserPreferences(prefs: UserPreferences): Promise<void>;

  getUserContact(userId: UserId): Promise<RecipientContactInfo | null>;
  setUserContact(userId: UserId, contact: RecipientContactInfo): Promise<void>;

  getDailyFundUsage(fundId: FundId, date: string): Promise<DailyFundUsage>;
}

type NotificationPreferencesStateRow = Omit<UserPreferences, "user_id"> & {
  erased_at: Date | null;
  has_preferences: boolean;
  has_whatsapp_consent: boolean;
  has_sms_consent: boolean;
  has_email_consent: boolean;
};

export class InMemoryNotificationStore implements NotificationStore {
  public outbox = new Map<string, NotificationOutboxRow>();
  public deadLetters: NotificationDeadLetterRow[] = [];
  public userPreferences = new Map<string, UserPreferences>();
  public userContacts = new Map<string, RecipientContactInfo>();
  public fundDailyUsage = new Map<string, DailyFundUsage>();
  private readonly deliveryEvents = new Map<
    string,
    {
      provider: "meta_whatsapp" | "exotel_sms";
      providerMessageId: string;
      status: "delivered" | "dead_letter";
      occurredAt: Date | null;
      now: Date;
    }
  >();

  async claimBatch(
    batchSize: number,
    leaseExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<NotificationOutboxRow[]> {
    for (const row of this.outbox.values()) {
      if (row.status === "sending" && row.lease_expires_at !== null && row.lease_expires_at < now) {
        const error = "Worker stopped during provider send; automatic retry suppressed";
        this.outbox.set(row.id, {
          ...row,
          status: "dead_letter",
          last_error: error,
          claim_token: null,
          lease_expires_at: null,
          updated_at: now,
        });
        this.deadLetters.push({
          id: uuidv7(),
          notification_id: row.id,
          fund_id: row.fund_id,
          user_id: row.user_id,
          idempotency_key: row.idempotency_key,
          template_id: row.template_id,
          template_data: row.template_data,
          attempts: row.attempts,
          last_error: error,
          cost_paise: row.cost_paise,
          dead_lettered_at: now,
        });
      }
    }
    const claimed: NotificationOutboxRow[] = [];

    for (const [id, row] of this.outbox.entries()) {
      if (claimed.length >= batchSize) break;

      const isPending = row.status === "pending" && row.next_attempt_at <= now;
      const isExpiredLease =
        row.status === "processing" && row.lease_expires_at !== null && row.lease_expires_at < now;

      if (isPending || isExpiredLease) {
        const updated: NotificationOutboxRow = {
          ...row,
          status: "processing",
          claim_token: uuidv7(),
          lease_expires_at: leaseExpiresAt,
          attempts: row.attempts + 1,
          updated_at: now,
        };
        this.outbox.set(id, updated);
        claimed.push(updated);
      }
    }

    return claimed;
  }

  async ownsClaim(id: string, claimToken: string, now: Date = new Date()): Promise<boolean> {
    const row = this.outbox.get(id);
    return Boolean(
      row &&
        row.status === "processing" &&
        row.claim_token === claimToken &&
        row.lease_expires_at !== null &&
        row.lease_expires_at > now,
    );
  }

  async prepareSend(input: {
    notificationId: string;
    claimToken: string;
    fundId: FundId;
    date: string;
    costPaise: Paise;
    now: Date;
  }): Promise<"prepared" | "cap_reached" | "claim_lost"> {
    const row = this.outbox.get(input.notificationId);
    if (
      row?.status !== "processing" ||
      row.claim_token !== input.claimToken ||
      !row.lease_expires_at ||
      row.lease_expires_at <= input.now
    )
      return "claim_lost";

    const costReserved = row.cost_reserved ?? false;
    if (!costReserved) {
      const usage = this.fundDailyUsage.get(`${input.fundId}:${input.date}`) ?? {
        fund_id: input.fundId,
        usage_date: input.date,
        sent_count: 0,
        total_cost_paise: paise(0),
        cap_count: DEFAULT_DAILY_NOTIFICATION_CAP,
      };
      if (usage.sent_count >= usage.cap_count) return "cap_reached";

      this.fundDailyUsage.set(`${input.fundId}:${input.date}`, {
        ...usage,
        sent_count: usage.sent_count + 1,
        total_cost_paise: addPaise(usage.total_cost_paise, input.costPaise),
      });
    }
    this.outbox.set(input.notificationId, {
      ...row,
      status: "sending",
      cost_paise: costReserved ? row.cost_paise : BigInt(input.costPaise),
      cost_reserved: true,
      updated_at: input.now,
    });
    return "prepared";
  }

  async markDelivered(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    now: Date = new Date(),
  ): Promise<boolean> {
    const existing = this.outbox.get(id);
    if (
      !existing ||
      !["processing", "sending"].includes(existing.status) ||
      existing.claim_token !== claimToken
    ) {
      return false;
    }
    this.outbox.set(id, {
      ...existing,
      status: "delivered",
      channel_used: channel,
      cost_paise: BigInt(costPaise),
      delivered_at: now,
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    });
    return true;
  }

  async markSubmitted(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    providerMessageId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const existing = this.outbox.get(id);
    if (existing?.status !== "sending" || existing.claim_token !== claimToken) return false;
    const submitted: NotificationOutboxRow = {
      ...existing,
      status: "submitted",
      channel_used: channel,
      cost_paise: BigInt(costPaise),
      provider_message_id: providerMessageId,
      provider_status: "accepted",
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    };
    this.outbox.set(id, submitted);
    const provider = channel === "whatsapp" ? "meta_whatsapp" : "exotel_sms";
    const earlyStatus = this.latestDeliveryEvent(provider, providerMessageId);
    if (earlyStatus) this.applyStatusToRow(submitted, earlyStatus.status, earlyStatus.now);
    return true;
  }

  async applyDeliveryStatus(
    provider: "meta_whatsapp" | "exotel_sms",
    providerMessageId: string,
    status: "delivered" | "dead_letter",
    eventKey: string,
    occurredAt: Date | null = null,
    now: Date = new Date(),
  ): Promise<boolean> {
    const key = `${provider}:${eventKey}`;
    if (this.deliveryEvents.has(key)) return false;
    this.deliveryEvents.set(key, { provider, providerMessageId, status, occurredAt, now });
    const row = [...this.outbox.values()].find(
      (item) =>
        item.provider_message_id === providerMessageId &&
        ["submitted", "delivered", "dead_letter"].includes(item.status) &&
        (provider === "meta_whatsapp"
          ? item.channel_used === "whatsapp"
          : item.channel_used === "sms"),
    );
    if (!row) return true;
    const latest = this.latestDeliveryEvent(provider, providerMessageId);
    if (latest) this.applyStatusToRow(row, latest.status, latest.occurredAt ?? latest.now);
    return true;
  }

  private latestDeliveryEvent(provider: "meta_whatsapp" | "exotel_sms", providerMessageId: string) {
    return [...this.deliveryEvents.entries()]
      .filter(
        ([, event]) => event.provider === provider && event.providerMessageId === providerMessageId,
      )
      .sort(([leftKey, left], [rightKey, right]) => {
        const leftTime = (left.occurredAt ?? left.now).getTime();
        const rightTime = (right.occurredAt ?? right.now).getTime();
        return leftTime - rightTime || leftKey.localeCompare(rightKey);
      })
      .at(-1)?.[1];
  }

  private applyStatusToRow(
    row: NotificationOutboxRow,
    status: "delivered" | "dead_letter",
    now: Date,
  ): void {
    this.outbox.set(row.id, {
      ...row,
      status,
      provider_status: status === "delivered" ? status : "failed",
      delivered_at: status === "delivered" ? now : null,
      updated_at: now,
    });
    if (status === "delivered") {
      this.deadLetters = this.deadLetters.filter((entry) => entry.notification_id !== row.id);
    } else if (!this.deadLetters.some((entry) => entry.notification_id === row.id)) {
      this.deadLetters.push({
        id: uuidv7(),
        notification_id: row.id,
        fund_id: row.fund_id,
        user_id: row.user_id,
        idempotency_key: row.idempotency_key,
        template_id: row.template_id,
        template_data: row.template_data,
        attempts: row.attempts,
        last_error: "Provider reported terminal delivery failure",
        cost_paise: row.cost_paise,
        dead_lettered_at: now,
      });
    }
  }

  async markFailed(
    id: string,
    claimToken: string,
    error: string,
    nextAttemptAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (
      !existing ||
      !["processing", "sending"].includes(existing.status) ||
      existing.claim_token !== claimToken
    )
      return;
    this.outbox.set(id, {
      ...existing,
      status: "pending",
      next_attempt_at: nextAttemptAt,
      last_error: error,
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    });
  }

  async markDeadLetter(
    id: string,
    claimToken: string,
    error: string,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (
      !existing ||
      !["processing", "sending"].includes(existing.status) ||
      existing.claim_token !== claimToken
    )
      return;
    this.outbox.set(id, {
      ...existing,
      status: "dead_letter",
      last_error: error,
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    });

    this.deadLetters.push({
      id: uuidv7(),
      notification_id: existing.id,
      fund_id: existing.fund_id,
      user_id: existing.user_id,
      idempotency_key: existing.idempotency_key,
      template_id: existing.template_id,
      template_data: existing.template_data,
      attempts: existing.attempts,
      last_error: error,
      cost_paise: existing.cost_paise,
      dead_lettered_at: now,
    });
  }

  async markSkipped(
    id: string,
    claimToken: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (existing?.status !== "processing" || existing.claim_token !== claimToken) return;
    this.outbox.set(id, {
      ...existing,
      status: "skipped",
      last_error: reason,
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    });
  }

  async reschedule(
    id: string,
    claimToken: string,
    nextAttemptAt: Date,
    decrementAttempt = false,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (existing?.status !== "processing" || existing.claim_token !== claimToken) return;
    this.outbox.set(id, {
      ...existing,
      status: "pending",
      next_attempt_at: nextAttemptAt,
      attempts: decrementAttempt ? Math.max(0, existing.attempts - 1) : existing.attempts,
      lease_expires_at: null,
      claim_token: null,
      updated_at: now,
    });
  }

  async getUserPreferences(userId: UserId): Promise<UserPreferences> {
    return this.userPreferences.get(userId) ?? getDefaultUserPreferences(userId);
  }

  async setUserPreferences(prefs: UserPreferences): Promise<void> {
    this.userPreferences.set(prefs.user_id, prefs);
  }

  async getUserContact(userId: UserId): Promise<RecipientContactInfo | null> {
    return this.userContacts.get(userId) ?? null;
  }

  async setUserContact(userId: UserId, contact: RecipientContactInfo): Promise<void> {
    this.userContacts.set(userId, contact);
  }

  async getDailyFundUsage(fundId: FundId, date: string): Promise<DailyFundUsage> {
    const key = `${fundId}:${date}`;
    return (
      this.fundDailyUsage.get(key) ?? {
        fund_id: fundId,
        usage_date: date,
        sent_count: 0,
        total_cost_paise: paise(0),
        cap_count: DEFAULT_DAILY_NOTIFICATION_CAP,
      }
    );
  }
}

export class PostgresNotificationStore implements NotificationStore {
  constructor(private readonly client: SqlTransaction) {}

  async claimBatch(
    batchSize: number,
    leaseExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<NotificationOutboxRow[]> {
    const abandoned = (await this.client.unsafe(
      `UPDATE notification_outbox SET status = 'dead_letter', last_error = $1,
         claim_token = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE status = 'sending' AND lease_expires_at < $2 RETURNING *`,
      ["Worker stopped during provider send; automatic retry suppressed", now],
    )) as NotificationOutboxRow[];
    for (const row of abandoned) {
      await this.client.unsafe(
        `INSERT INTO notification_dead_letter (id, notification_id, fund_id, user_id, idempotency_key, template_id, template_data, attempts, last_error, cost_paise, dead_lettered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          uuidv7(),
          row.id,
          row.fund_id,
          row.user_id,
          row.idempotency_key,
          row.template_id,
          row.template_data,
          row.attempts,
          "Worker stopped during provider send; automatic retry suppressed",
          row.cost_paise,
          now,
        ],
      );
    }
    const rows = (await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'processing',
           claim_token = gen_random_uuid(),
           lease_expires_at = $1,
           attempts = attempts + 1,
           updated_at = $2
       WHERE id IN (
         SELECT id FROM notification_outbox
         WHERE (status = 'pending' AND next_attempt_at <= $2)
            OR (status = 'processing' AND lease_expires_at < $2)
         ORDER BY next_attempt_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [leaseExpiresAt, now, batchSize],
    )) as NotificationOutboxRow[];

    return rows.map((row) => ({
      ...row,
      template_data:
        typeof row.template_data === "string"
          ? (JSON.parse(row.template_data) as NotificationOutboxRow["template_data"])
          : row.template_data,
    }));
  }

  async ownsClaim(id: string, claimToken: string, now: Date = new Date()): Promise<boolean> {
    const rows = (await this.client.unsafe(
      `SELECT EXISTS (
         SELECT 1 FROM notification_outbox
         WHERE id = $1 AND claim_token = $2 AND status = 'processing' AND lease_expires_at > $3
       ) AS owned`,
      [id, claimToken, now],
    )) as Array<{ owned: boolean }>;
    return rows[0]?.owned ?? false;
  }

  async prepareSend(input: {
    notificationId: string;
    claimToken: string;
    fundId: FundId;
    date: string;
    costPaise: Paise;
    now: Date;
  }): Promise<"prepared" | "cap_reached" | "claim_lost"> {
    const rows = (await this.client.unsafe(
      `WITH owned AS MATERIALIZED (
         SELECT id, cost_reserved FROM notification_outbox
         WHERE id = $1 AND claim_token = $2 AND status = 'processing' AND lease_expires_at > $7
         FOR UPDATE
       ), reserved AS (
         INSERT INTO fund_notification_daily_usage (
           fund_id, usage_date, sent_count, total_cost_paise, cap_count, updated_at
         )
         SELECT $3, $4, 1, $6, $5, $7 FROM owned WHERE NOT cost_reserved
         ON CONFLICT (fund_id, usage_date) DO UPDATE SET
           sent_count = fund_notification_daily_usage.sent_count + 1,
           total_cost_paise = fund_notification_daily_usage.total_cost_paise + $6,
           updated_at = $7
         WHERE fund_notification_daily_usage.sent_count < fund_notification_daily_usage.cap_count
         RETURNING sent_count
       ), marked AS (
         UPDATE notification_outbox AS notification
         SET status = 'sending',
           cost_paise = CASE WHEN notification.cost_reserved THEN notification.cost_paise ELSE $6 END,
           cost_reserved = TRUE,
           updated_at = $7
         WHERE notification.id = $1 AND notification.claim_token = $2
           AND notification.status = 'processing' AND notification.lease_expires_at > $7
           AND (notification.cost_reserved OR EXISTS (SELECT 1 FROM reserved))
         RETURNING id
       )
       SELECT EXISTS (SELECT 1 FROM owned) AS owned,
         EXISTS (SELECT 1 FROM reserved) AS reserved,
         EXISTS (SELECT 1 FROM marked) AS marked`,
      [
        input.notificationId,
        input.claimToken,
        input.fundId,
        input.date,
        DEFAULT_DAILY_NOTIFICATION_CAP,
        input.costPaise,
        input.now,
      ],
    )) as Array<{ owned: boolean; reserved: boolean; marked: boolean }>;
    const result = rows[0];
    if (result?.marked) return "prepared";
    if (!result?.owned) return "claim_lost";
    return "cap_reached";
  }

  async markDelivered(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    now: Date = new Date(),
  ): Promise<boolean> {
    const rows = (await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'delivered',
           channel_used = $1,
           cost_paise = $2,
           delivered_at = $3,
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $3
       WHERE id = $4 AND claim_token = $5 AND status IN ('processing', 'sending')
       RETURNING id`,
      [channel, costPaise, now, id, claimToken],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async markSubmitted(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    providerMessageId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const rows = (await this.client.unsafe(
      `WITH early_event AS (
         SELECT provider_status FROM notification_delivery_events
         WHERE provider = $7 AND provider_message_id = $3
         ORDER BY COALESCE(provider_occurred_at, received_at) DESC, event_key DESC LIMIT 1
       ), submitted AS (
         UPDATE notification_outbox AS notification
         SET status = CASE
             WHEN early_event.provider_status = 'dead_letter' THEN 'dead_letter'
             WHEN early_event.provider_status = 'delivered' THEN 'delivered'
             ELSE 'submitted'
           END,
           channel_used = $1,
           cost_paise = $2,
           provider_message_id = $3,
           provider_status = CASE
             WHEN early_event.provider_status = 'dead_letter' THEN 'failed'
             ELSE COALESCE(early_event.provider_status, 'accepted')
           END,
           delivered_at = CASE WHEN early_event.provider_status = 'delivered' THEN $4 ELSE NULL END,
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $4
         FROM (SELECT 1) AS singleton LEFT JOIN early_event ON TRUE
         WHERE notification.id = $5 AND notification.claim_token = $6 AND notification.status = 'sending'
         RETURNING notification.*
       ), dead_letter AS (
         INSERT INTO notification_dead_letter (
           id, notification_id, fund_id, user_id, idempotency_key, template_id,
           template_data, attempts, last_error, cost_paise, dead_lettered_at
         )
         SELECT $8, id, fund_id, user_id, idempotency_key, template_id,
           template_data, attempts, 'Provider reported terminal delivery failure', cost_paise, $4
         FROM submitted WHERE status = 'dead_letter'
           AND NOT EXISTS (SELECT 1 FROM notification_dead_letter WHERE notification_id = submitted.id)
         RETURNING id
       )
       SELECT EXISTS (SELECT 1 FROM submitted) AS submitted`,
      [
        channel,
        costPaise,
        providerMessageId,
        now,
        id,
        claimToken,
        channel === "whatsapp" ? "meta_whatsapp" : "exotel_sms",
        uuidv7(),
      ],
    )) as Array<{ submitted: boolean }>;
    return rows[0]?.submitted ?? false;
  }

  async applyDeliveryStatus(
    provider: "meta_whatsapp" | "exotel_sms",
    providerMessageId: string,
    status: "delivered" | "dead_letter",
    eventKey: string,
    occurredAt: Date | null = null,
    now: Date = new Date(),
  ): Promise<boolean> {
    const channel = provider === "meta_whatsapp" ? "whatsapp" : "sms";
    const rows = (await this.client.unsafe(
      `WITH recorded AS (
         INSERT INTO notification_delivery_events (
           provider, provider_message_id, provider_status, event_key, provider_occurred_at, received_at
         ) VALUES ($1, $2, $3, $4, $6, $7)
         ON CONFLICT (provider, event_key) DO NOTHING
         RETURNING provider_status, provider_occurred_at, received_at, event_key
       ), candidate_events AS (
         SELECT provider_status, provider_occurred_at, received_at, event_key
         FROM notification_delivery_events WHERE provider = $1 AND provider_message_id = $2
         UNION ALL
         SELECT provider_status, provider_occurred_at, received_at, event_key FROM recorded
       ), latest_event AS (
         SELECT provider_status, provider_occurred_at FROM candidate_events
         ORDER BY COALESCE(provider_occurred_at, received_at) DESC, event_key DESC LIMIT 1
       ), applied AS (
         UPDATE notification_outbox SET
           status = CASE WHEN latest_event.provider_status = 'dead_letter' THEN 'dead_letter' ELSE 'delivered' END,
           provider_status = CASE WHEN latest_event.provider_status = 'dead_letter' THEN 'failed' ELSE 'delivered' END,
           delivered_at = CASE WHEN latest_event.provider_status = 'delivered' THEN COALESCE(latest_event.provider_occurred_at, $7) ELSE NULL END,
           updated_at = $7
         FROM latest_event
         WHERE provider_message_id = $2 AND channel_used = $5
           AND status IN ('submitted', 'delivered', 'dead_letter')
         RETURNING *
       ), dead_letter AS (
         INSERT INTO notification_dead_letter (
           id, notification_id, fund_id, user_id, idempotency_key, template_id,
           template_data, attempts, last_error, cost_paise, dead_lettered_at
         )
         SELECT $8, applied.id, fund_id, user_id, idempotency_key, template_id,
           template_data, attempts, 'Provider reported terminal delivery failure', cost_paise, $7
         FROM applied WHERE status = 'dead_letter'
           AND NOT EXISTS (SELECT 1 FROM notification_dead_letter WHERE notification_id = applied.id)
         RETURNING id
       ), cleared_dead_letter AS (
         DELETE FROM notification_dead_letter AS dead_letter
         USING applied WHERE dead_letter.notification_id = applied.id AND applied.status = 'delivered'
         RETURNING dead_letter.id
       )
       SELECT EXISTS (SELECT 1 FROM recorded) AS recorded`,
      [provider, providerMessageId, status, eventKey, channel, occurredAt, now, uuidv7()],
    )) as Array<{ recorded: boolean }>;
    return rows[0]?.recorded ?? false;
  }

  async markFailed(
    id: string,
    claimToken: string,
    error: string,
    nextAttemptAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'pending',
           next_attempt_at = $1,
           last_error = $2,
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $3
       WHERE id = $4 AND claim_token = $5 AND status IN ('processing', 'sending')`,
      [nextAttemptAt, error, now, id, claimToken],
    );
  }

  async markDeadLetter(
    id: string,
    claimToken: string,
    error: string,
    now: Date = new Date(),
  ): Promise<void> {
    const rows = (await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'dead_letter',
           last_error = $1,
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $2
       WHERE id = $3 AND claim_token = $4 AND status IN ('processing', 'sending')
       RETURNING *`,
      [error, now, id, claimToken],
    )) as NotificationOutboxRow[];

    const row = rows[0];
    if (row) {
      await this.client.unsafe(
        `INSERT INTO notification_dead_letter (
          id, notification_id, fund_id, user_id, idempotency_key,
          template_id, template_data, attempts, last_error, cost_paise, dead_lettered_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          uuidv7(),
          row.id,
          row.fund_id,
          row.user_id,
          row.idempotency_key,
          row.template_id,
          row.template_data,
          row.attempts,
          error,
          row.cost_paise,
          now,
        ],
      );
    }
  }

  async markSkipped(
    id: string,
    claimToken: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'skipped',
           last_error = $1,
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $2
       WHERE id = $3 AND claim_token = $4 AND status = 'processing'`,
      [reason, now, id, claimToken],
    );
  }

  async reschedule(
    id: string,
    claimToken: string,
    nextAttemptAt: Date,
    decrementAttempt = false,
    now: Date = new Date(),
  ): Promise<void> {
    const attemptAdjustment = decrementAttempt ? `GREATEST(0, attempts - 1)` : `attempts`;
    await this.client.unsafe(
      `UPDATE notification_outbox
       SET status = 'pending',
           next_attempt_at = $1,
           attempts = ${attemptAdjustment},
           lease_expires_at = NULL,
           claim_token = NULL,
           updated_at = $2
       WHERE id = $3 AND claim_token = $4 AND status = 'processing'`,
      [nextAttemptAt, now, id, claimToken],
    );
  }

  async getUserPreferences(userId: UserId): Promise<UserPreferences> {
    const rows = (await this.client.unsafe(
      `SELECT u.erased_at,
         p.user_id IS NOT NULL AS has_preferences,
         EXISTS (SELECT 1 FROM consent_records c WHERE c.user_id = u.id
           AND c.purpose = 'notification_whatsapp' AND c.withdrawn_at IS NULL) AS has_whatsapp_consent,
         EXISTS (SELECT 1 FROM consent_records c WHERE c.user_id = u.id
           AND c.purpose = 'notification_sms' AND c.withdrawn_at IS NULL) AS has_sms_consent,
         EXISTS (SELECT 1 FROM consent_records c WHERE c.user_id = u.id
           AND c.purpose = 'notification_email' AND c.withdrawn_at IS NULL) AS has_email_consent,
         COALESCE(p.whatsapp_enabled, true) AS whatsapp_enabled,
         COALESCE(p.sms_enabled, true) AS sms_enabled,
         COALESCE(p.email_enabled, true) AS email_enabled,
         COALESCE(p.opted_out, false) AS opted_out,
         COALESCE(p.locale, 'en') AS locale,
         COALESCE(p.quiet_hours_enabled, false) AS quiet_hours_enabled,
         p.quiet_hours_start,
         p.quiet_hours_end,
         COALESCE(p.timezone, 'Asia/Kolkata') AS timezone
       FROM users u
       LEFT JOIN user_notification_preferences p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    )) as NotificationPreferencesStateRow[];

    const row = rows[0];
    if (!row) {
      return getDefaultUserPreferences(userId);
    }

    if (row.erased_at !== null) {
      return {
        ...getDefaultUserPreferences(userId),
        whatsapp_enabled: false,
        sms_enabled: false,
        email_enabled: false,
        opted_out: true,
      };
    }

    if (row.locale !== "en" && row.locale !== "hi") {
      throw new Error("Invalid notification preference locale");
    }

    const defaults = getDefaultUserPreferences(userId);
    return {
      user_id: userId,
      whatsapp_enabled: row.has_whatsapp_consent && (!row.has_preferences || row.whatsapp_enabled),
      sms_enabled: row.has_sms_consent && (!row.has_preferences || row.sms_enabled),
      email_enabled: row.has_email_consent && (!row.has_preferences || row.email_enabled),
      opted_out: row.has_preferences ? row.opted_out : defaults.opted_out,
      locale: row.has_preferences ? row.locale : defaults.locale,
      quiet_hours_enabled: row.has_preferences
        ? row.quiet_hours_enabled
        : defaults.quiet_hours_enabled,
      quiet_hours_start: row.has_preferences ? row.quiet_hours_start : defaults.quiet_hours_start,
      quiet_hours_end: row.has_preferences ? row.quiet_hours_end : defaults.quiet_hours_end,
      timezone: row.has_preferences ? row.timezone : defaults.timezone,
    };
  }

  async setUserPreferences(prefs: UserPreferences): Promise<void> {
    await this.client.unsafe(
      `INSERT INTO user_notification_preferences (
        user_id, whatsapp_enabled, sms_enabled, email_enabled, opted_out,
        locale, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        whatsapp_enabled = EXCLUDED.whatsapp_enabled,
        sms_enabled = EXCLUDED.sms_enabled,
        email_enabled = EXCLUDED.email_enabled,
        opted_out = EXCLUDED.opted_out,
        locale = EXCLUDED.locale,
        quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
        quiet_hours_start = EXCLUDED.quiet_hours_start,
        quiet_hours_end = EXCLUDED.quiet_hours_end,
        timezone = EXCLUDED.timezone,
        updated_at = CURRENT_TIMESTAMP`,
      [
        prefs.user_id,
        prefs.whatsapp_enabled,
        prefs.sms_enabled,
        prefs.email_enabled,
        prefs.opted_out,
        prefs.locale,
        prefs.quiet_hours_enabled,
        prefs.quiet_hours_start,
        prefs.quiet_hours_end,
        prefs.timezone,
      ],
    );
  }

  async getUserContact(userId: UserId): Promise<RecipientContactInfo | null> {
    const rows = (await this.client.unsafe(
      `SELECT phone FROM users WHERE id = $1 AND erased_at IS NULL`,
      [userId],
    )) as Array<{ phone: string }>;

    const row = rows[0];
    if (!row) return null;
    return { phone: row.phone };
  }

  async setUserContact(userId: UserId, contact: RecipientContactInfo): Promise<void> {
    if (contact.phone) {
      await this.client.unsafe(`UPDATE users SET phone = $1 WHERE id = $2`, [
        contact.phone,
        userId,
      ]);
    }
  }

  async getDailyFundUsage(fundId: FundId, date: string): Promise<DailyFundUsage> {
    const rows = (await this.client.unsafe(
      `SELECT * FROM fund_notification_daily_usage WHERE fund_id = $1 AND usage_date = $2`,
      [fundId, date],
    )) as FundNotificationDailyUsageRow[];

    const row = rows[0];
    if (!row) {
      return {
        fund_id: fundId,
        usage_date: date,
        sent_count: 0,
        total_cost_paise: paise(0),
        cap_count: DEFAULT_DAILY_NOTIFICATION_CAP,
      };
    }

    return {
      fund_id: fundId,
      usage_date: date,
      sent_count: row.sent_count,
      total_cost_paise: paise(Number(row.total_cost_paise)),
      cap_count: row.cap_count,
    };
  }
}
