import type { Paise } from "@yen/shared";
import { fundIdSchema, userIdSchema } from "@yen/shared";
import * as z from "zod";

export const notificationChannelSchema = z.enum(["whatsapp", "sms", "email"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationStatusSchema = z.enum([
  "pending",
  "processing",
  "sending",
  "submitted",
  "delivered",
  "failed",
  "dead_letter",
  "skipped",
]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationTemplateIdSchema = z.enum([
  "approval_needed",
  "approved_rejected",
  "donation_received",
  "objection_raised",
  "weekly_summary",
  "fund_alert",
  "large_expense_alert",
]);
export type NotificationTemplateId = z.infer<typeof notificationTemplateIdSchema>;

export const notificationLocaleSchema = z.enum(["en", "hi"]);
export type NotificationLocale = z.infer<typeof notificationLocaleSchema>;

export const approvalNeededDataSchema = z.object({
  fund_title: z.string().min(1),
  expense_id: z.string().min(1),
  amount_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
  purpose: z.string().optional(),
  requester_pseudonym: z.string().optional(),
});
export type ApprovalNeededData = z.infer<typeof approvalNeededDataSchema>;

export const approvedRejectedDataSchema = z.object({
  fund_title: z.string().min(1),
  expense_id: z.string().min(1),
  amount_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]).optional(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});
export type ApprovedRejectedData = z.infer<typeof approvedRejectedDataSchema>;

export const donationReceivedDataSchema = z.object({
  fund_title: z.string().min(1),
  donation_id: z.string().min(1),
  amount_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
  donor_pseudonym: z.string().optional(),
});
export type DonationReceivedData = z.infer<typeof donationReceivedDataSchema>;

export const objectionRaisedDataSchema = z.object({
  fund_title: z.string().min(1),
  expense_id: z.string().min(1),
  objection_id: z.string().min(1),
  reason: z.string().optional(),
  unsubscribe_url: z.string().optional(),
});
export type ObjectionRaisedData = z.infer<typeof objectionRaisedDataSchema>;

export const spendingCategoryItemSchema = z.object({
  category: z.string().min(1),
  amount_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
});
export type SpendingCategoryItem = z.infer<typeof spendingCategoryItemSchema>;

export const weeklySummaryDataSchema = z.object({
  fund_title: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  donations_count: z.number().int().nonnegative(),
  total_donations_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
  expenses_count: z.number().int().nonnegative(),
  total_expenses_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
  breakdown: z.array(spendingCategoryItemSchema).optional(),
  unsubscribe_url: z.string().optional(),
});
export type WeeklySummaryData = z.infer<typeof weeklySummaryDataSchema>;

export const fundAlertDataSchema = z.object({
  fund_title: z.string().min(1),
  alert_type: z.string().min(1),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string().min(1),
  variant: z.enum(["raised", "escalation"]).default("raised"),
});
export type FundAlertData = z.infer<typeof fundAlertDataSchema>;

export const largeExpenseAlertDataSchema = z.object({
  fund_title: z.string().min(1),
  expense_id: z.string().min(1),
  amount_paise: z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
  description: z.string().optional(),
  unsubscribe_url: z.string().optional(),
});
export type LargeExpenseAlertData = z.infer<typeof largeExpenseAlertDataSchema>;

export const templateDataSchemas = {
  approval_needed: approvalNeededDataSchema,
  approved_rejected: approvedRejectedDataSchema,
  donation_received: donationReceivedDataSchema,
  objection_raised: objectionRaisedDataSchema,
  weekly_summary: weeklySummaryDataSchema,
  fund_alert: fundAlertDataSchema,
  large_expense_alert: largeExpenseAlertDataSchema,
} as const;

export type TemplateDataMap = {
  approval_needed: ApprovalNeededData;
  approved_rejected: ApprovedRejectedData;
  donation_received: DonationReceivedData;
  objection_raised: ObjectionRaisedData;
  weekly_summary: WeeklySummaryData;
  fund_alert: FundAlertData;
  large_expense_alert: LargeExpenseAlertData;
};

export const enqueueNotificationInputSchema = z.object({
  fund_id: fundIdSchema,
  user_id: userIdSchema,
  event_id: z.string().optional(),
  idempotency_key: z.string().min(1),
  template_id: notificationTemplateIdSchema,
  template_data: z.record(z.string(), z.unknown()),
  preferred_channel: notificationChannelSchema.optional().default("whatsapp"),
  max_attempts: z.number().int().positive().optional().default(3),
});
export type EnqueueNotificationInput = z.input<typeof enqueueNotificationInputSchema>;

export const userPreferencesSchema = z.object({
  user_id: userIdSchema,
  whatsapp_enabled: z.boolean().default(true),
  sms_enabled: z.boolean().default(true),
  email_enabled: z.boolean().default(true),
  opted_out: z.boolean().default(false),
  locale: notificationLocaleSchema.default("en"),
  quiet_hours_enabled: z.boolean().default(false),
  quiet_hours_start: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .nullable()
    .default(null),
  quiet_hours_end: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .nullable()
    .default(null),
  timezone: z.string().default("Asia/Kolkata"),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export interface RenderedTemplate {
  subject?: string;
  body: string;
  locale: NotificationLocale;
}

export interface DeliveryResult {
  success: boolean;
  channel: NotificationChannel;
  cost_paise: Paise;
  provider_message_id?: string;
  provider_status?: "accepted" | "delivered" | "failed";
  error?: string;
  skipped?: boolean;
  retryable?: boolean;
}
