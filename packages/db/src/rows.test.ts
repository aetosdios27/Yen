import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fundEventRowSchema,
  fundRowSchema,
  idempotencyKeyRowSchema,
  membershipRowSchema,
  orgRowSchema,
  pseudonymRowSchema,
  userRowSchema,
} from "./rows.js";

describe("row parsing at the database boundary", () => {
  const id = randomUUID();
  const now = new Date();

  it("parses userRowSchema rejecting phone numbers with leading zeros", () => {
    expect(
      userRowSchema.safeParse({
        id,
        phone: "+910987654321",
        display_name: "Test",
        locale: "en",
        created_at: now,
      }).success,
    ).toBe(false);

    const valid = userRowSchema.parse({
      id,
      phone: "+919876543210",
      display_name: "Test",
      locale: "en",
      created_at: now,
    });
    expect(valid.phone).toBe("+919876543210");
  });

  it("parses orgRowSchema", () => {
    const valid = orgRowSchema.parse({
      id,
      name: "Org",
      legal_form: "trust",
      owner_id: id,
      created_at: now,
    });
    expect(valid.name).toBe("Org");
  });

  it("parses fundRowSchema with null target_paise", () => {
    const valid = fundRowSchema.parse({
      id,
      org_id: id,
      title: "Fund",
      target_paise: null,
      visibility_tier: "public",
      policy_json: { threshold: 100 },
      status: "active",
      created_at: now,
    });
    expect(valid.target_paise).toBeNull();
  });

  it("parses membershipRowSchema", () => {
    const valid = membershipRowSchema.parse({
      fund_id: id,
      user_id: id,
      role: "treasurer",
      status: "active",
      created_at: now,
    });
    expect(valid.role).toBe("treasurer");
  });

  it("parses pseudonymRowSchema", () => {
    const valid = pseudonymRowSchema.parse({
      pseudonym_id: id,
      user_id: id,
    });
    expect(valid.pseudonym_id).toBe(id);
  });

  it("parses idempotencyKeyRowSchema rejecting undefined response", () => {
    expect(
      idempotencyKeyRowSchema.safeParse({
        key: "key",
        request_hash: "hash",
        response: undefined,
        created_at: now,
      }).success,
    ).toBe(false);
  });

  it("parses fundEventRowSchema transforming bigint seq to number", () => {
    const rawEvent = {
      fund_id: id,
      seq: 1n,
      type: "fund.created",
      version: 1,
      actor: `psn_${id}`,
      occurred_at: "2026-01-01T00:00:00.000Z",
      payload: { org_id: id, visibility: "private" },
      prev_hash: "0".repeat(64),
      hash: "a".repeat(64),
      canonical_envelope: "{}",
    };
    const parsed = fundEventRowSchema.parse(rawEvent);
    expect(parsed.seq).toBe(1);
    expect(parsed.fund_id).toBe(id);
    expect(fundEventRowSchema.safeParse({ ...rawEvent, fund_id: "invalid" }).success).toBe(false);
    expect(fundEventRowSchema.safeParse({ ...rawEvent, version: 2 }).success).toBe(false);
  });

  it("validates notification outbox and preference rows", async () => {
    const {
      notificationOutboxRowSchema,
      userNotificationPreferencesRowSchema,
      fundNotificationDailyUsageRowSchema,
      notificationDeadLetterRowSchema,
    } = await import("./rows.js");

    const validOutbox = {
      id,
      fund_id: id,
      user_id: id,
      event_id: "evt-123",
      idempotency_key: "notify:f1:u1:test",
      template_id: "approval_needed",
      template_data: { expense_id: id, amount_paise: 5000 },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: now,
      claim_token: id,
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
    expect(notificationOutboxRowSchema.safeParse(validOutbox).success).toBe(true);
    expect(
      notificationOutboxRowSchema.safeParse({ ...validOutbox, status: "unknown" }).success,
    ).toBe(false);
    expect(
      notificationOutboxRowSchema.safeParse({ ...validOutbox, template_id: "invalid" }).success,
    ).toBe(false);

    const validPrefs = {
      user_id: id,
      whatsapp_enabled: true,
      sms_enabled: true,
      email_enabled: false,
      opted_out: false,
      locale: "hi",
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      timezone: "Asia/Kolkata",
      updated_at: now,
    };
    expect(userNotificationPreferencesRowSchema.safeParse(validPrefs).success).toBe(true);
    expect(
      userNotificationPreferencesRowSchema.safeParse({ ...validPrefs, locale: "fr" }).success,
    ).toBe(false);

    const validUsage = {
      fund_id: id,
      usage_date: "2026-10-28",
      sent_count: 5,
      total_cost_paise: 150n,
      cap_count: 100,
      updated_at: now,
    };
    expect(fundNotificationDailyUsageRowSchema.safeParse(validUsage).success).toBe(true);

    const validDeadLetter = {
      id,
      notification_id: id,
      fund_id: id,
      user_id: id,
      idempotency_key: "notify:key",
      template_id: "approval_needed",
      template_data: {},
      attempts: 3,
      last_error: "Provider failed",
      cost_paise: 0n,
      dead_lettered_at: now,
    };
    expect(notificationDeadLetterRowSchema.safeParse(validDeadLetter).success).toBe(true);
  });
});
