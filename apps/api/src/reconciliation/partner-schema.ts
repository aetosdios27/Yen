import { paise } from "@yen/shared";
import { z } from "zod";
import type { ParsedBankTransaction } from "./types.js";

/**
 * Payment partner webhook payload schema for boundary validation.
 * Enforces strict typing, prevents unexpected attributes, and parses amounts to Paise.
 */
export const partnerWebhookSchema = z
  .object({
    event: z.string().min(1).max(100),
    timestamp: z.string().datetime(),
    data: z
      .object({
        fund_id: z.string().uuid(),
        bank_reference: z.string().trim().min(1).max(128),
        amount_paise: z
          .union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)])
          .transform((v) => (typeof v === "number" ? paise(v) : paise(Number(v)))),
        type: z.enum(["credit", "debit"]).default("credit"),
        posted_at: z.string().datetime(),
        utr: z
          .string()
          .regex(/^[0-9]{12}$/)
          .optional(),
        narration: z.string().trim().max(500).optional(),
        counterparty: z
          .object({
            vpa: z.string().trim().max(256).optional(),
            name: z.string().trim().max(120).optional(),
          })
          .optional(),
      })
      .passthrough(),
  })
  .strict();

export type PartnerWebhookPayload = z.infer<typeof partnerWebhookSchema>;

/**
 * Validates and normalizes raw webhook payload into ParsedBankTransaction.
 */
export function normalizePartnerWebhook(raw: unknown): ParsedBankTransaction {
  const parsed = partnerWebhookSchema.parse(raw);
  const { data } = parsed;

  return {
    fundId: data.fund_id,
    bankReference: data.bank_reference,
    utr: data.utr,
    amountPaise: data.amount_paise,
    type: data.type,
    postedAt: data.posted_at,
    narration: data.narration,
    counterpartyVpa: data.counterparty?.vpa,
    counterpartyName: data.counterparty?.name,
    source: "webhook_partner",
    rawPayload: raw as Record<string, unknown>,
  };
}
