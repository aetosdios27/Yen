import { parseFundId, parseOrgId, parsePhoneE164, parseUserId } from "@yen/shared";
import * as z from "zod";

function brandedId<T>(
  parse: (input: unknown) => { ok: true; value: T } | { ok: false; error: string },
) {
  return z.unknown().transform((input, context) => {
    const result = parse(input);
    if (result.ok) return result.value;
    context.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  });
}

const userId = brandedId(parseUserId);
const orgId = brandedId(parseOrgId);
const fundId = brandedId(parseFundId);
const phoneE164 = brandedId(parsePhoneE164);

export const userRowSchema = z.object({
  id: userId,
  phone: phoneE164,
  display_name: z.string(),
  locale: z.string(),
  created_at: z.date(),
});

export const orgRowSchema = z.object({
  id: orgId,
  name: z.string(),
  legal_form: z.string(),
  owner_id: userId,
  created_at: z.date(),
});

export const fundRowSchema = z.object({
  id: fundId,
  org_id: orgId,
  title: z.string(),
  target_paise: z.bigint().nonnegative().nullable(),
  visibility_tier: z.enum(["public", "donors", "members", "private"]),
  policy_json: z.json(),
  status: z.enum(["draft", "active", "closed"]),
  created_at: z.date(),
});

export const membershipRowSchema = z.object({
  fund_id: fundId,
  user_id: userId,
  role: z.enum(["owner", "treasurer", "approver", "auditor", "member"]),
  status: z.enum(["invited", "active", "removed"]),
  created_at: z.date(),
});

export const pseudonymRowSchema = z.object({
  pseudonym_id: z.uuid(),
  user_id: userId,
});

export const idempotencyKeyRowSchema = z.object({
  key: z.string(),
  request_hash: z.string(),
  response: z.json(),
  created_at: z.date(),
});

export const fundEventRowSchema = z.object({
  fund_id: fundId,
  seq: z.bigint().transform((n) => Number(n)),
  type: z.string(),
  version: z.literal(1),
  actor: z.string(),
  occurred_at: z.string(),
  payload: z.json(),
  prev_hash: z.string(),
  hash: z.string(),
  canonical_envelope: z.string(),
});

export type UserRow = z.infer<typeof userRowSchema>;
export type OrgRow = z.infer<typeof orgRowSchema>;
export type FundRow = z.infer<typeof fundRowSchema>;
export type MembershipRow = z.infer<typeof membershipRowSchema>;
export type PseudonymRow = z.infer<typeof pseudonymRowSchema>;
export type IdempotencyKeyRow = z.infer<typeof idempotencyKeyRowSchema>;

export const notificationOutboxRowSchema = z.object({
  id: z.uuid(),
  fund_id: fundId,
  user_id: userId,
  event_id: z.string().nullable(),
  idempotency_key: z.string(),
  template_id: z.enum([
    "approval_needed",
    "approved_rejected",
    "donation_received",
    "objection_raised",
    "weekly_summary",
  ]),
  template_data: z.json(),
  preferred_channel: z.enum(["whatsapp", "sms", "email"]),
  status: z.enum(["pending", "processing", "delivered", "failed", "dead_letter", "skipped"]),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  next_attempt_at: z.date(),
  claim_token: z.uuid().nullable().optional(),
  lease_expires_at: z.date().nullable(),
  delivered_at: z.date().nullable(),
  channel_used: z.enum(["whatsapp", "sms", "email"]).nullable(),
  cost_paise: z.bigint().nonnegative(),
  last_error: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const userNotificationPreferencesRowSchema = z.object({
  user_id: userId,
  whatsapp_enabled: z.boolean(),
  sms_enabled: z.boolean(),
  email_enabled: z.boolean(),
  opted_out: z.boolean(),
  locale: z.enum(["en", "hi"]),
  quiet_hours_enabled: z.boolean(),
  quiet_hours_start: z.string().nullable(),
  quiet_hours_end: z.string().nullable(),
  timezone: z.string(),
  updated_at: z.date(),
});

export const fundNotificationDailyUsageRowSchema = z.object({
  fund_id: fundId,
  usage_date: z.union([z.string(), z.date()]),
  sent_count: z.number().int().nonnegative(),
  total_cost_paise: z.bigint().nonnegative(),
  cap_count: z.number().int().nonnegative(),
  updated_at: z.date(),
});

export const notificationDeadLetterRowSchema = z.object({
  id: z.uuid(),
  notification_id: z.uuid(),
  fund_id: fundId,
  user_id: userId,
  idempotency_key: z.string(),
  template_id: z.string(),
  template_data: z.json(),
  attempts: z.number().int().nonnegative(),
  last_error: z.string(),
  cost_paise: z.bigint().nonnegative(),
  dead_lettered_at: z.date(),
});

export type NotificationOutboxRow = z.infer<typeof notificationOutboxRowSchema>;
export type UserNotificationPreferencesRow = z.infer<typeof userNotificationPreferencesRowSchema>;
export type FundNotificationDailyUsageRow = z.infer<typeof fundNotificationDailyUsageRowSchema>;
export type NotificationDeadLetterRow = z.infer<typeof notificationDeadLetterRowSchema>;
export type FundEventRow = z.infer<typeof fundEventRowSchema>;
