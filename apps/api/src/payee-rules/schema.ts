import { z } from "@hono/zod-openapi";
import { createUnverifiedPayee, type FraudFlagCode } from "@yen/policy";
import { isValidGstinFormat, validateGstinChecksum } from "@yen/shared";

const ifsc = z
  .string()
  .trim()
  .refine(
    (value) => /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(value.replace(/\s/g, "")),
    "Expected an IFSC code",
  );
const account = z
  .string()
  .trim()
  .refine(
    (value) => /^[0-9]{6,24}$/.test(value.replace(/\s/g, "")),
    "Expected a bank account number",
  );
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => isValidGstinFormat(value) && validateGstinChecksum(value), "Invalid GSTIN");

export const payeeIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upi"),
      vpa: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bank"),
      account,
      ifsc,
    })
    .strict(),
]);

export const payeeInputSchema = z
  .object({
    identity: payeeIdentitySchema,
    name: z.string().trim().min(1).max(80),
    gstin: gstin.optional(),
  })
  .strict();

export const payeeOutputSchema = z
  .object({
    identity: payeeIdentitySchema,
    name: z.string(),
    gstin: z.string().optional(),
    verification: z
      .object({
        status: z.enum(["unverified", "verified", "failed"]),
        provider: z.string().optional(),
        reference: z.string().optional(),
        verifiedAt: z.iso.datetime().optional(),
      })
      .strict(),
  })
  .strict();

export const fraudFlagCodeSchema = z.enum([
  "new_payee_large_first_payment",
  "payee_changed_cooling_off",
  "self_payment",
  "split_requests",
  "duplicate_invoice",
  "duplicate_evidence",
  "gstin_name_mismatch",
  "payee_velocity",
]) satisfies z.ZodType<FraudFlagCode>;

export const fraudFlagSchema = z
  .object({
    code: fraudFlagCodeSchema,
    reason: z.string().min(1),
  })
  .strict();

export const fraudAcknowledgementSchema = z
  .object({
    code: fraudFlagCodeSchema,
    actorPseudonym: z.string().regex(/^psn_[0-9a-f-]{36}$/),
    reason: z.string().min(1).max(1000),
    acknowledgedAt: z.iso.datetime(),
  })
  .strict();

export function normalizedPayee(input: z.infer<typeof payeeInputSchema>) {
  return createUnverifiedPayee({
    identity: input.identity,
    name: input.name,
    ...(input.gstin ? { gstin: input.gstin } : {}),
  });
}
