import type {
  FundNotificationDailyUsageRow,
  NotificationDeadLetterRow,
  NotificationOutboxRow,
  UserNotificationPreferencesRow,
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

  markDelivered(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
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
  incrementFundUsage(fundId: FundId, date: string, costPaise: Paise): Promise<DailyFundUsage>;
}

export class InMemoryNotificationStore implements NotificationStore {
  public outbox = new Map<string, NotificationOutboxRow>();
  public deadLetters: NotificationDeadLetterRow[] = [];
  public userPreferences = new Map<string, UserPreferences>();
  public userContacts = new Map<string, RecipientContactInfo>();
  public fundDailyUsage = new Map<string, DailyFundUsage>();

  async claimBatch(
    batchSize: number,
    leaseExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<NotificationOutboxRow[]> {
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

  async markDelivered(
    id: string,
    claimToken: string,
    channel: NotificationChannel,
    costPaise: Paise,
    now: Date = new Date(),
  ): Promise<boolean> {
    const existing = this.outbox.get(id);
    if (existing?.status !== "processing" || existing.claim_token !== claimToken) {
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

  async markFailed(
    id: string,
    claimToken: string,
    error: string,
    nextAttemptAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (existing?.status !== "processing" || existing.claim_token !== claimToken) return;
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
    if (existing?.status !== "processing" || existing.claim_token !== claimToken) return;
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

  async incrementFundUsage(
    fundId: FundId,
    date: string,
    costPaise: Paise,
  ): Promise<DailyFundUsage> {
    const current = await this.getDailyFundUsage(fundId, date);
    const updated: DailyFundUsage = {
      ...current,
      sent_count: current.sent_count + 1,
      total_cost_paise: addPaise(current.total_cost_paise, costPaise),
    };
    this.fundDailyUsage.set(`${fundId}:${date}`, updated);
    return updated;
  }
}

export class PostgresNotificationStore implements NotificationStore {
  constructor(private readonly client: SqlTransaction) {}

  async claimBatch(
    batchSize: number,
    leaseExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<NotificationOutboxRow[]> {
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
       WHERE id = $4 AND claim_token = $5 AND status = 'processing'
       RETURNING id`,
      [channel, costPaise, now, id, claimToken],
    )) as Array<{ id: string }>;
    return rows.length > 0;
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
       WHERE id = $4 AND claim_token = $5 AND status = 'processing'`,
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
       WHERE id = $3 AND claim_token = $4 AND status = 'processing'
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
      `SELECT * FROM user_notification_preferences WHERE user_id = $1`,
      [userId],
    )) as UserNotificationPreferencesRow[];

    const row = rows[0];
    if (!row) {
      return getDefaultUserPreferences(userId);
    }

    return {
      user_id: userId,
      whatsapp_enabled: row.whatsapp_enabled,
      sms_enabled: row.sms_enabled,
      email_enabled: row.email_enabled,
      opted_out: row.opted_out,
      locale: row.locale as "en" | "hi",
      quiet_hours_enabled: row.quiet_hours_enabled,
      quiet_hours_start: row.quiet_hours_start,
      quiet_hours_end: row.quiet_hours_end,
      timezone: row.timezone,
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
    const rows = (await this.client.unsafe(`SELECT phone FROM users WHERE id = $1`, [
      userId,
    ])) as Array<{ phone: string }>;

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

  async incrementFundUsage(
    fundId: FundId,
    date: string,
    costPaise: Paise,
  ): Promise<DailyFundUsage> {
    const rows = (await this.client.unsafe(
      `INSERT INTO fund_notification_daily_usage (
        fund_id, usage_date, sent_count, total_cost_paise, cap_count, updated_at
      ) VALUES ($1, $2, 1, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (fund_id, usage_date) DO UPDATE SET
        sent_count = fund_notification_daily_usage.sent_count + 1,
        total_cost_paise = fund_notification_daily_usage.total_cost_paise + $3,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [fundId, date, costPaise, DEFAULT_DAILY_NOTIFICATION_CAP],
    )) as FundNotificationDailyUsageRow[];

    const row = rows[0];
    return {
      fund_id: fundId,
      usage_date: date,
      sent_count: row?.sent_count ?? 1,
      total_cost_paise: paise(Number(row?.total_cost_paise ?? costPaise)),
      cap_count: row?.cap_count ?? DEFAULT_DAILY_NOTIFICATION_CAP,
    };
  }
}
