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
 * Signature envelope carried by partner webhook headers. The partner signs
 * the exact raw request bytes with HMAC-SHA256 over "v1.<unix-seconds>.<body>"
 * (see apps/api webhook-signature.ts for the verification implementation).
 * The envelope schema is the transport-agnostic shape Yen stores for audit.
 */
export const partnerSignatureEnvelopeSchema = z.object({
  scheme: z.literal("hmac-sha256-v1"),
  keyId: z.string().trim().min(1).max(64),
  /** Unix epoch seconds as a canonical unsigned decimal string. */
  timestamp: z.string().regex(/^(?:0|[1-9][0-9]{0,11})$/),
  /** Lowercase hex HMAC-SHA256 digest (64 chars). */
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export type PartnerSignatureEnvelope = z.infer<typeof partnerSignatureEnvelopeSchema>;

/**
 * Builds a validated signature envelope from verified webhook headers. Call
 * only after HMAC verification succeeds; this type records what was trusted,
 * it does not perform the trust decision.
 */
export function toPartnerSignatureEnvelope(input: {
  keyId: string;
  timestamp: string;
  signature: string;
}): PartnerSignatureEnvelope {
  return partnerSignatureEnvelopeSchema.parse({
    scheme: "hmac-sha256-v1",
    keyId: input.keyId,
    timestamp: input.timestamp,
    signature: input.signature,
  });
}

/**
 * Result of verifying that a VPA belongs to the expected beneficiary before
 * a payout is initiated (or a donation is matched). The partner resolves the
 * VPA's registered name; Yen compares it against the expected beneficiary
 * name it already holds. `unavailable` covers partner outages and must be
 * treated as fail-closed by callers (do not pay against an unverified VPA).
 */
export const vpaVerificationResultSchema = z.object({
  vpa: z.string().trim().min(1).max(256),
  status: z.enum(["matched", "mismatched", "not_found", "unavailable"]),
  /** Name registered against the VPA at the partner, if resolved. */
  registeredName: z.string().trim().min(1).max(120).optional(),
  /** Beneficiary name Yen expected when it queued the verification. */
  expectedName: z.string().trim().min(1).max(120).optional(),
  verifiedAt: z.string().datetime(),
  provider: z.string().trim().min(1).max(64),
});

export type VpaVerificationResult = z.infer<typeof vpaVerificationResultSchema>;

/**
 * Builds a validated VPA verification result, rejecting impossible states
 * such as a match with no registered name or a mismatch with no names to
 * compare. Fail-closed statuses carry no silent defaults.
 */
export function toVpaVerificationResult(input: VpaVerificationResult): VpaVerificationResult {
  if (input.status === "matched" && input.registeredName === undefined) {
    throw new RangeError("A matched VPA verification must include the registered name");
  }
  return vpaVerificationResultSchema.parse(input);
}

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
