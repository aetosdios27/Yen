import { paise, type Paise } from "@yen/shared";
import { z } from "zod";

/**
 * Payment partner boundary types for Yen (YEN-7).
 *
 * Yen never holds, pools, or settles club funds. A regulated payment partner
 * (payment aggregator or bank) provides statement webhooks, VPA verification,
 * and payout initiation against the club's own bank account. These types are
 * the adapter boundary Yen validates partner traffic against; every monetary
 * amount is an integer number of paise (see @yen/shared `Paise`), never a
 * float.
 */

/**
 * Canonical wire form for integer paise at the JSON boundary. JSON has no
 * bigint, so partner payloads carry amounts as canonical decimal strings
 * (same convention as `paiseWire` in @yen/shared) to eliminate any chance of
 * IEEE-754 drift for amounts beyond 2^53.
 */
export const partnerAmountPaiseWire = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/, "Amount must be a canonical integer paise decimal string")
  .refine(
    (value) => Number.isSafeInteger(Number(value)),
    "Amount exceeds the safe integer range",
  );

const counterpartySchema = z.object({
  vpa: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

const webhookEventDataShape = {
  fund_id: z.string().uuid(),
  bank_reference: z.string().trim().min(1).max(128),
  amount_paise: partnerAmountPaiseWire,
  posted_at: z.string().datetime(),
  utr: z
    .string()
    .regex(/^[0-9]{12}$/)
    .optional(),
  narration: z.string().trim().max(500).optional(),
  counterparty: counterpartySchema.optional(),
} as const;

/** Partner webhook announcing money received into the club's bank account. */
export const partnerCreditWebhookSchema = z
  .object({
    event: z.string().min(1).max(100),
    timestamp: z.string().datetime(),
    data: z.object({ ...webhookEventDataShape, type: z.literal("credit") }).passthrough(),
  })
  .strict();

/** Partner webhook announcing money sent out of the club's bank account. */
export const partnerDebitWebhookSchema = z
  .object({
    event: z.string().min(1).max(100),
    timestamp: z.string().datetime(),
    data: z.object({ ...webhookEventDataShape, type: z.literal("debit") }).passthrough(),
  })
  .strict();

/** Discriminated union of partner statement webhooks by money direction. */
export const partnerWebhookEventSchema = z.union([
  partnerCreditWebhookSchema,
  partnerDebitWebhookSchema,
]);

export type PartnerCreditWebhookEvent = z.infer<typeof partnerCreditWebhookSchema>;
export type PartnerDebitWebhookEvent = z.infer<typeof partnerDebitWebhookSchema>;
export type PartnerWebhookEvent = z.infer<typeof partnerWebhookEventSchema>;

/**
 * Normalized, partner-agnostic statement entry produced from a validated
 * webhook event (or statement export) after signature verification.
 * `amountPaise` is a branded safe integer; `direction` carries the sign so
 * the entry itself is always nonnegative.
 */
export const partnerStatementEntrySchema = z.object({
  entryId: z.string().trim().min(1).max(128),
  fundId: z.string().uuid(),
  direction: z.enum(["credit", "debit"]),
  amountPaise: z
    .number()
    .int()
    .refine((value) => Number.isSafeInteger(value), "Amount must be a safe integer paise value"),
  postedAt: z.string().datetime(),
  bankReference: z.string().trim().min(1).max(128),
  utr: z
    .string()
    .regex(/^[0-9]{12}$/)
    .optional(),
  narration: z.string().trim().max(500).optional(),
  counterpartyVpa: z.string().trim().max(256).optional(),
  source: z.literal("partner_webhook"),
});

export type PartnerStatementEntry = z.infer<typeof partnerStatementEntrySchema> & {
  readonly amountPaise: Paise;
};

/**
 * Builds a normalized statement entry from a validated partner webhook event,
 * coercing the wire paise string into a branded safe integer via the exact
 * decimal text (no float parsing anywhere on this path).
 */
export function toPartnerStatementEntry(
  event: PartnerWebhookEvent,
  entryId: string,
): PartnerStatementEntry {
  const { data } = event;
  const amountPaise = paise(Number(data.amount_paise));
  return partnerStatementEntrySchema.parse({
    entryId,
    fundId: data.fund_id,
    direction: data.type,
    amountPaise,
    postedAt: data.posted_at,
    bankReference: data.bank_reference,
    utr: data.utr,
    narration: data.narration,
    counterpartyVpa: data.counterparty?.vpa,
    source: "partner_webhook",
  }) as PartnerStatementEntry;
}
