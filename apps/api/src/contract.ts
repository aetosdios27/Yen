import { createRoute, z } from "@hono/zod-openapi";
import { paiseWire } from "@yen/shared";
import { errorEnvelope } from "./errors.js";

const responseHeaders = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
  },
} as const;

function jsonResponse<T extends z.ZodType>(schema: T, description: string) {
  return { description, headers: responseHeaders, content: { "application/json": { schema } } };
}

const internalResponse = jsonResponse(
  errorEnvelope,
  "Internal failure; no private error information",
);
const limitedResponse = {
  ...jsonResponse(errorEnvelope, "Rate limit exceeded"),
  headers: {
    ...responseHeaders,
    "retry-after": {
      schema: { type: "integer" as const, minimum: 1 },
      description: "Seconds until retry",
    },
  },
};
const protectedErrors = {
  400: jsonResponse(errorEnvelope, "Validation failed; details contain field paths"),
  401: jsonResponse(errorEnvelope, "Authentication required"),
  403: jsonResponse(errorEnvelope, "Access denied"),
  404: jsonResponse(errorEnvelope, "Resource not found"),
  409: jsonResponse(
    errorEnvelope,
    "Resource conflict, changed idempotency input, or request in progress",
  ),
  429: limitedResponse,
  500: internalResponse,
};
const security = [{ bearerAuth: [] }];

export const principalSchema = z.object({ id: z.string().uuid() }).openapi("Principal");
export const fundInput = z
  .object({ name: z.string().trim().min(1).max(120), targetPaise: paiseWire })
  .strict()
  .openapi("CreateFund");
export const fundSchema = fundInput
  .extend({ id: z.string().uuid(), createdAt: z.iso.datetime() })
  .openapi("Fund");

const statusSchema = z.object({ status: z.literal("ok") });

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "health",
  summary: "Liveness",
  responses: { 200: jsonResponse(statusSchema, "Process is alive"), 500: internalResponse },
});
export const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  operationId: "ready",
  summary: "Readiness",
  responses: { 200: jsonResponse(statusSchema, "Dependencies are ready"), 500: internalResponse },
});
export const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  operationId: "getMe",
  security,
  description: "Auth seam: returns only an injected dev/test principal until YEN-22.",
  responses: { 200: jsonResponse(principalSchema, "Current principal"), ...protectedErrors },
});
export const idempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const createFundRoute = createRoute({
  method: "post",
  path: "/v1/funds",
  operationId: "createFund",
  security,
  description:
    "STUB: creates an in-memory fake fund. Data is lost on restart. Requires Idempotency-Key; identical method, URL, content type and body bytes replay. A changed request or an in-progress duplicate returns 409. Money is nonnegative integer paise encoded as canonical decimal strings.",
  request: {
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
    }),
    body: { required: true, content: { "application/json": { schema: fundInput } } },
  },
  responses: {
    201: {
      ...jsonResponse(fundSchema, "Fake fund created"),
      headers: {
        ...responseHeaders,
        "idempotent-replayed": {
          schema: { type: "string", enum: ["true"] },
          description: "Present on replay",
        },
      },
    },
    ...protectedErrors,
  },
});
export const getFundRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}",
  operationId: "getFund",
  security,
  description:
    "STUB: reads a fake fund created in this process by the same principal. Invalid canonical FundId or missing fund returns 404.",
  request: {
    params: z.object({ fundId: z.string().openapi({ param: { name: "fundId", in: "path" } }) }),
  },
  responses: { 200: jsonResponse(fundSchema, "Fake fund"), ...protectedErrors },
});
export const openapiSchema = z.record(z.string(), z.unknown());

export const openapiRoute = createRoute({
  method: "get",
  path: "/v1/openapi.json",
  operationId: "getOpenApi",
  responses: {
    200: jsonResponse(openapiSchema, "OpenAPI 3.1 contract"),
    429: limitedResponse,
    500: internalResponse,
  },
});
