import type { PhoneE164 } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  fundPseudonymRowSchema,
  fundRowSchema,
  idempotencyKeyRowSchema,
  membershipRowSchema,
  orgRowSchema,
  pseudonymRowSchema,
  type UserRow,
  userApprovalPinRowSchema,
  userRowSchema,
} from "./rows.js";
import { uuidv7 } from "./uuidv7.js";

const id = uuidv7();
const now = new Date();
const fund = {
  id,
  org_id: id,
  title: "Festival",
  target_paise: 0n,
  visibility_tier: "donors",
  policy_json: { approvers: 2 },
  status: "active",
  created_at: now,
};

describe("row parsing at the database boundary", () => {
  it("rejects malformed or noncanonical shared IDs", () => {
    const user = {
      id,
      phone: "+919000000001",
      display_name: "Owner",
      locale: "en",
      created_at: now,
      assurance: "otp_verified",
    };
    expect(userRowSchema.safeParse({ ...user, id: "invalid" }).success).toBe(false);
    expect(
      userRowSchema.safeParse({ ...user, id: "AAAAAAAA-AAAA-7AAA-8AAA-AAAAAAAAAAAA" }).success,
    ).toBe(false);
    expect(
      orgRowSchema.safeParse({
        id,
        name: "Club",
        legal_form: "club",
        owner_id: "invalid",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(fundRowSchema.safeParse({ ...fund, org_id: null }).success).toBe(false);
  });

  it("requires bigint paise and rejects negative values", () => {
    expect(fundRowSchema.parse(fund).target_paise).toBe(0n);
    for (const target_paise of [1, "1", -1n, 1.5]) {
      expect(fundRowSchema.safeParse({ ...fund, target_paise }).success).toBe(false);
    }
  });

  it("requires canonical E.164 phone values in user rows", () => {
    expectTypeOf<UserRow["phone"]>().toEqualTypeOf<PhoneE164>();
    const user = {
      id,
      display_name: "Owner",
      locale: "en",
      created_at: now,
      assurance: "otp_verified" as const,
    };
    expect(userRowSchema.safeParse({ ...user, phone: "+919876543210" }).success).toBe(true);
    for (const phone of ["9876543210", "+91 98765 43210", ""]) {
      expect(userRowSchema.safeParse({ ...user, phone }).success).toBe(false);
    }
  });

  it("rejects invalid enums and non-JSON values", () => {
    expect(fundRowSchema.safeParse({ ...fund, visibility_tier: "secret" }).success).toBe(false);
    expect(fundRowSchema.safeParse({ ...fund, policy_json: { amount: 1n } }).success).toBe(false);
    expect(
      membershipRowSchema.safeParse({
        fund_id: id,
        user_id: id,
        role: "admin",
        status: "active",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(pseudonymRowSchema.safeParse({ pseudonym_id: "invalid", user_id: id }).success).toBe(
      false,
    );
    expect(
      fundPseudonymRowSchema.safeParse({
        pseudonym_id: "invalid",
        user_id: id,
        fund_id: id,
        created_at: now,
      }).success,
    ).toBe(false);
    expect(
      fundPseudonymRowSchema.safeParse({
        pseudonym_id: id,
        user_id: "invalid",
        fund_id: id,
        created_at: now,
      }).success,
    ).toBe(false);
    expect(
      fundPseudonymRowSchema.safeParse({
        pseudonym_id: id,
        user_id: id,
        fund_id: "invalid",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(
      fundPseudonymRowSchema.safeParse({
        pseudonym_id: id,
        user_id: id,
        fund_id: id,
        created_at: now,
      }).success,
    ).toBe(true);
    expect(
      idempotencyKeyRowSchema.safeParse({
        key: "key",
        request_hash: "hash",
        response: undefined,
        created_at: now,
      }).success,
    ).toBe(false);
  });

  it("parses fundEventRowSchema transforming bigint seq to number", async () => {
    const { fundEventRowSchema } = await import("./rows.js");
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

  it("validates approval pin rows and rejects invalid statuses or negative attempts", () => {
    const pin = {
      user_id: id,
      salt: "1234567890abcdef",
      pin_hash: "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789",
      failed_attempts: 0,
      total_failed_24h: 0,
      first_failed_at: null,
      locked_until: null,
      cooling_off_until: null,
      status: "active" as const,
      created_at: now,
      updated_at: now,
    };
    expect(userApprovalPinRowSchema.safeParse(pin).success).toBe(true);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, status: "unknown" }).success).toBe(false);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, failed_attempts: -1 }).success).toBe(false);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, total_failed_24h: -1 }).success).toBe(
      false,
    );
    expect(userApprovalPinRowSchema.safeParse({ ...pin, user_id: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});
