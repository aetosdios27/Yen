import { randomBytes } from "node:crypto";
import type { FundSubscriptionRow, Sql } from "@yen/db";
import { uuidv7 } from "@yen/db";
import type { NotificationChannel } from "./types.js";

export interface FundSubscription {
  readonly id: string;
  readonly fundId: string;
  readonly contact: string;
  readonly contactType: "email" | "phone";
  readonly channel: NotificationChannel;
  readonly weeklySummary: boolean;
  readonly instantAlerts: boolean;
  readonly status: "active" | "unsubscribed";
  readonly unsubscribeToken: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly unsubscribedAt: Date | null;
}

export interface SubscribeInput {
  readonly fundId: string;
  readonly contact: string;
  readonly channel?: NotificationChannel | undefined;
  readonly weeklySummary?: boolean | undefined;
  readonly instantAlerts?: boolean | undefined;
}

export interface FundSubscriptionStore {
  subscribe(input: SubscribeInput): Promise<FundSubscription>;
  unsubscribe(token: string): Promise<boolean>;
  getByToken(token: string): Promise<FundSubscription | null>;
  getActiveSubscribers(
    fundId: string,
    filter?: { weeklySummary?: boolean; instantAlerts?: boolean },
  ): Promise<FundSubscription[]>;
}

export function generateUnsubscribeToken(): string {
  return randomBytes(32).toString("hex");
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47) {
    end--;
  }
  const normalized = trimmed.slice(0, end);
  return `${normalized}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function determineContactType(contact: string): "email" | "phone" {
  return contact.includes("@") ? "email" : "phone";
}

export class PostgresFundSubscriptionStore implements FundSubscriptionStore {
  constructor(private readonly sql: Sql) {}

  async subscribe(input: SubscribeInput): Promise<FundSubscription> {
    const id = uuidv7();
    const token = generateUnsubscribeToken();
    const contactType = determineContactType(input.contact);
    const channel = input.channel ?? (contactType === "email" ? "email" : "whatsapp");
    const weeklySummary = input.weeklySummary ?? true;
    const instantAlerts = input.instantAlerts ?? true;

    const rows = await this.sql<FundSubscriptionRow[]>`
      INSERT INTO fund_subscriptions (
        id, fund_id, contact, contact_type, channel,
        weekly_summary, instant_alerts, status,
        unsubscribe_token, created_at, updated_at
      ) VALUES (
        ${id}, ${input.fundId}, ${input.contact}, ${contactType}, ${channel},
        ${weeklySummary}, ${instantAlerts}, 'active',
        ${token}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (fund_id, contact) DO UPDATE SET
        channel = EXCLUDED.channel,
        weekly_summary = EXCLUDED.weekly_summary,
        instant_alerts = EXCLUDED.instant_alerts,
        status = 'active',
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const row = rows[0];
    if (!row) throw new Error("Failed to create fund subscription");
    return this.mapRow(row);
  }

  async unsubscribe(token: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE fund_subscriptions
      SET status = 'unsubscribed',
          unsubscribed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE unsubscribe_token = ${token} AND status = 'active'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async getByToken(token: string): Promise<FundSubscription | null> {
    const rows = await this.sql<FundSubscriptionRow[]>`
      SELECT * FROM fund_subscriptions
      WHERE unsubscribe_token = ${token}
    `;
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async getActiveSubscribers(
    fundId: string,
    filter?: { weeklySummary?: boolean; instantAlerts?: boolean },
  ): Promise<FundSubscription[]> {
    const rows = await this.sql<FundSubscriptionRow[]>`
      SELECT * FROM fund_subscriptions
      WHERE fund_id = ${fundId}
        AND status = 'active'
        ${filter?.weeklySummary ? this.sql`AND weekly_summary = true` : this.sql``}
        ${filter?.instantAlerts ? this.sql`AND instant_alerts = true` : this.sql``}
      ORDER BY created_at ASC
    `;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: FundSubscriptionRow): FundSubscription {
    return {
      id: row.id,
      fundId: String(row.fund_id),
      contact: row.contact,
      contactType: row.contact_type,
      channel: row.channel,
      weeklySummary: row.weekly_summary,
      instantAlerts: row.instant_alerts,
      status: row.status,
      unsubscribeToken: row.unsubscribe_token,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      unsubscribedAt: row.unsubscribed_at,
    };
  }
}

export class MemoryFundSubscriptionStore implements FundSubscriptionStore {
  private readonly subscriptions = new Map<string, FundSubscription>();

  async subscribe(input: SubscribeInput): Promise<FundSubscription> {
    const contactType = determineContactType(input.contact);
    const channel = input.channel ?? (contactType === "email" ? "email" : "whatsapp");
    const key = `${input.fundId}:${input.contact}`;

    const existing = this.subscriptions.get(key);
    if (existing) {
      const updated: FundSubscription = {
        ...existing,
        channel,
        weeklySummary: input.weeklySummary ?? existing.weeklySummary,
        instantAlerts: input.instantAlerts ?? existing.instantAlerts,
        status: "active",
        unsubscribedAt: null,
        updatedAt: new Date(),
      };
      this.subscriptions.set(key, updated);
      return updated;
    }

    const sub: FundSubscription = {
      id: uuidv7(),
      fundId: input.fundId,
      contact: input.contact,
      contactType,
      channel,
      weeklySummary: input.weeklySummary ?? true,
      instantAlerts: input.instantAlerts ?? true,
      status: "active",
      unsubscribeToken: generateUnsubscribeToken(),
      createdAt: new Date(),
      updatedAt: new Date(),
      unsubscribedAt: null,
    };
    this.subscriptions.set(key, sub);
    return sub;
  }

  async unsubscribe(token: string): Promise<boolean> {
    for (const [key, sub] of this.subscriptions.entries()) {
      if (sub.unsubscribeToken === token && sub.status === "active") {
        this.subscriptions.set(key, {
          ...sub,
          status: "unsubscribed",
          unsubscribedAt: new Date(),
          updatedAt: new Date(),
        });
        return true;
      }
    }
    return false;
  }

  async getByToken(token: string): Promise<FundSubscription | null> {
    for (const sub of this.subscriptions.values()) {
      if (sub.unsubscribeToken === token) {
        return sub;
      }
    }
    return null;
  }

  async getActiveSubscribers(
    fundId: string,
    filter?: { weeklySummary?: boolean; instantAlerts?: boolean },
  ): Promise<FundSubscription[]> {
    const results: FundSubscription[] = [];
    for (const sub of this.subscriptions.values()) {
      if (sub.fundId === fundId && sub.status === "active") {
        if (filter?.weeklySummary && !sub.weeklySummary) continue;
        if (filter?.instantAlerts && !sub.instantAlerts) continue;
        results.push(sub);
      }
    }
    return results;
  }
}
