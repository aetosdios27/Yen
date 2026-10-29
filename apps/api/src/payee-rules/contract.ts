import { createRoute, z } from "@hono/zod-openapi";
import { paiseWire } from "@yen/shared";
import { idempotencyKey, responseHeaders } from "../contract.js";
import { errorEnvelope } from "../errors.js";
import {
  fraudAcknowledgementSchema,
  fraudFlagCodeSchema,
  fraudFlagSchema,
  payeeInputSchema,
  payeeOutputSchema,
} from "./schema.js";

const security = [{ bearerAuth: [] }];
const responses = {
  400: {
    description: "Validation failed",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  401: {
    description: "Authentication required",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  403: {
    description: "Access denied",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  404: {
    description: "Resource not found",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  409: {
    description: "Resource conflict",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
  500: {
    description: "Internal failure",
    headers: responseHeaders,
    content: { "application/json": { schema: errorEnvelope } },
  },
};
const fundAndExpenseParams = z.object({
  fundId: z.string().uuid(),
  expenseId: z.string().uuid(),
});
const mutationHeaders = z.object({
  "Idempotency-Key": idempotencyKey,
  "x-approval-pin": z.string().optional(),
  "x-approval-token": z.string().optional(),
});
const positivePaise = paiseWire.refine(
  (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0,
  "Expected positive paise within the safe integer range",
);

export const payeeChangeRoute = createRoute({
  method: "put",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/payee",
  tags: ["expenses", "payee rules"],
  operationId: "changeExpensePayee",
  security,
  description:
    "Changes an expense payee. Requires a PIN or one-use approval token and re-evaluates payee fraud rules.",
  request: {
    headers: mutationHeaders,
    params: fundAndExpenseParams,
    body: { required: true, content: { "application/json": { schema: payeeInputSchema } } },
  },
  responses: {
    200: {
      description: "Expense payee updated",
      headers: responseHeaders,
      content: {
        "application/json": {
          schema: z
            .object({ payee: payeeOutputSchema, fraudFlags: z.array(fraudFlagSchema) })
            .strict(),
        },
      },
    },
    ...responses,
  },
});

export const acknowledgeFraudFlagRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/fraud-acknowledgements",
  tags: ["expenses", "payee rules"],
  operationId: "acknowledgeExpenseFraudFlag",
  security,
  description: "Records an owner's reasoned acknowledgement for a blocking payee fraud flag.",
  request: {
    headers: mutationHeaders,
    params: fundAndExpenseParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ code: fraudFlagCodeSchema, reason: z.string().trim().min(1).max(1000) })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Acknowledgement recorded",
      headers: responseHeaders,
      content: {
        "application/json": {
          schema: z.object({ acknowledgements: z.array(fraudAcknowledgementSchema) }).strict(),
        },
      },
    },
    ...responses,
  },
});

export const setMemberPayeeProfileRoute = createRoute({
  method: "put",
  path: "/v1/funds/{fundId}/members/{pseudonymId}/payee-profile",
  tags: ["members", "payee rules"],
  operationId: "setMemberPayeeProfile",
  security,
  description:
    "Sets the caller's payee fingerprint, or an officeholder's fingerprint by an owner. The normalized identifier is never returned.",
  request: {
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    params: z.object({
      fundId: z.string().uuid(),
      pseudonymId: z.string().regex(/^psn_[0-9a-f-]{36}$/),
    }),
    body: { required: true, content: { "application/json": { schema: payeeInputSchema } } },
  },
  responses: {
    200: {
      description: "Fingerprint stored",
      headers: responseHeaders,
      content: { "application/json": { schema: z.object({ status: z.literal("set") }).strict() } },
    },
    ...responses,
  },
});

export const clearMemberPayeeProfileRoute = createRoute({
  method: "delete",
  path: "/v1/funds/{fundId}/members/{pseudonymId}/payee-profile",
  tags: ["members", "payee rules"],
  operationId: "clearMemberPayeeProfile",
  security,
  description:
    "Clears the caller's payee fingerprint, or an officeholder's fingerprint by an owner.",
  request: {
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    params: z.object({
      fundId: z.string().uuid(),
      pseudonymId: z.string().regex(/^psn_[0-9a-f-]{36}$/),
    }),
  },
  responses: {
    200: {
      description: "Fingerprint removed",
      headers: responseHeaders,
      content: {
        "application/json": { schema: z.object({ status: z.literal("cleared") }).strict() },
      },
    },
    ...responses,
  },
});

export const updatePayeeRulesPolicyRoute = createRoute({
  method: "put",
  path: "/v1/funds/{fundId}/payee-rules/policy",
  tags: ["payee rules"],
  operationId: "updatePayeeRulesPolicy",
  security,
  description:
    "Configures per-fund payee-fraud thresholds and the flags that block approval. Owner only.",
  request: {
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    params: z.object({ fundId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              newPayeeFirstPaymentPaise: positivePaise,
              largeExpensePaise: positivePaise,
              coolingOffHours: z.number().int().min(0).max(8760),
              splitWindowHours: z.number().int().min(1).max(8760),
              approvalThresholdPaise: positivePaise,
              velocityWindowHours: z.number().int().min(1).max(8760),
              velocityMaxPaise: positivePaise,
              blockedFlagCodes: z
                .array(fraudFlagCodeSchema)
                .refine((codes) => new Set(codes).size === codes.length)
                .refine(
                  (codes) => codes.includes("self_payment"),
                  "Self-payment must remain blocking",
                ),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Policy updated",
      headers: responseHeaders,
      content: {
        "application/json": { schema: z.object({ status: z.literal("updated") }).strict() },
      },
    },
    ...responses,
  },
});
