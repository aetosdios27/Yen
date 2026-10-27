import { createRoute, z } from "@hono/zod-openapi";
import { paiseWire } from "@yen/shared";
import { errorEnvelope } from "./errors.js";

const responseHeaders = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
    required: true,
  },
} as const;
const replayHeader = {
  "idempotent-replayed": {
    schema: { type: "string" as const, enum: ["true"] },
    description: "Present on replay",
  },
};
const retryHeader = {
  "retry-after": {
    schema: { type: "string" as const, pattern: "^[1-9][0-9]*$" },
    description: "Seconds until retry",
  },
};

function jsonResponse<T extends z.ZodType>(schema: T, description: string) {
  return { description, headers: responseHeaders, content: { "application/json": { schema } } };
}

function withReplay<T extends { headers: object }>(response: T) {
  return { ...response, headers: { ...response.headers, ...replayHeader } };
}

const internalResponse = jsonResponse(
  errorEnvelope,
  "Internal failure; no private error information",
);
const limitedResponse = {
  ...jsonResponse(errorEnvelope, "Rate limit exceeded"),
  headers: {
    ...responseHeaders,
    "retry-after": { ...retryHeader["retry-after"], required: true },
  },
};
const overloadedResponse = {
  ...jsonResponse(errorEnvelope, "Rate limit store at capacity"),
  headers: { ...responseHeaders, "retry-after": { ...retryHeader["retry-after"], required: true } },
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
  503: overloadedResponse,
};
const security = [{ bearerAuth: [] }];

export const principalSchema = z.object({ id: z.string().uuid() }).openapi("Principal");
const fundFields = { name: z.string().trim().min(1).max(120), targetPaise: paiseWire };
export const fundInput = z.object(fundFields).strict().openapi("CreateFund");
export const fundSchema = z
  .object({ ...fundFields, id: z.string().uuid(), createdAt: z.iso.datetime() })
  .strict()
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
  responses: {
    200: jsonResponse(statusSchema, "Dependencies are ready"),
    503: jsonResponse(errorEnvelope, "Dependency unavailable"),
    500: internalResponse,
  },
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
  tags: ["funds"],
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
    201: withReplay(jsonResponse(fundSchema, "Fake fund created")),
    400: withReplay(protectedErrors[400]),
    401: withReplay(protectedErrors[401]),
    403: withReplay(protectedErrors[403]),
    404: withReplay(protectedErrors[404]),
    409: {
      ...withReplay(protectedErrors[409]),
      headers: { ...responseHeaders, ...replayHeader, ...retryHeader },
    },
    429: protectedErrors[429],
    500: protectedErrors[500],
    503: protectedErrors[503],
  },
});
export const getFundRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}",
  tags: ["funds"],
  operationId: "getFund",
  security,
  description:
    "STUB: reads a fake fund created in this process by the same principal. Invalid canonical FundId, missing fund, or policy denial returns 404 to conceal existence.",
  request: {
    params: z.object({
      fundId: z.string().openapi({
        description: "Canonical lowercase FundId UUID; invalid IDs return 404",
        param: { name: "fundId", in: "path" },
      }),
    }),
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
    503: overloadedResponse,
    500: internalResponse,
  },
});

const validCharacters = (value: string, multiline = false) =>
  Array.from(value).every((character) => {
    const code = character.codePointAt(0);
    if (code === undefined) return false;
    if (multiline && (code === 9 || code === 10)) return true;
    return code > 31 && !(code >= 127 && code <= 159) && !(code >= 0xd800 && code <= 0xdfff);
  });
const bounded = (max: number, multiline = false) =>
  z
    .string()
    .refine(
      (value) => validCharacters(value, multiline),
      "Control characters and lone surrogates are not allowed",
    )
    .trim()
    .refine(
      (value) => Array.from(value).length >= 1 && Array.from(value).length <= max,
      `Expected 1–${max} characters`,
    )
    .openapi({ minLength: 1, maxLength: max });
const contact = z
  .string()
  .refine(
    (value) => validCharacters(value),
    "Control characters and lone surrogates are not allowed",
  )
  .trim()
  .refine(
    (value) => Array.from(value).length >= 3 && Array.from(value).length <= 254,
    "Expected 3–254 characters",
  )
  .openapi({
    minLength: 3,
    maxLength: 254,
    pattern: `(?:${z.regexes.email.source})|(?:^\\+[1-9][0-9]{7,14}$)|(?:^(?=.{10,19}$)[6-9](?:[ -]*[0-9]){9}[ -]*$)`,
    description:
      "Email address, international phone in + digits form, or Indian 10-digit mobile number with optional spaces or hyphens.",
  })
  .refine((value) => {
    if (value.includes("@")) return z.email().safeParse(value).success;
    return (
      /^\+[1-9][0-9]{7,14}$/.test(value) ||
      (/^[6-9][0-9 -]{9,18}$/.test(value) && /^[6-9][0-9]{9}$/.test(value.replace(/[ -]/g, "")))
    );
  }, "Expected an email or phone number");
export const waitlistInput = z
  .object({
    name: bounded(200),
    contact,
    org: bounded(200),
    locale: z.enum(["en", "hi"]),
    consent: z
      .object({ accepted: z.literal(true), text: bounded(1000, true), version: bounded(40) })
      .strict(),
  })
  .strict()
  .openapi("WaitlistInput");
export const waitlistRoute = createRoute({
  method: "post",
  path: "/v1/waitlist",
  operationId: "joinWaitlist",
  tags: ["waitlist"],
  request: { body: { required: true, content: { "application/json": { schema: waitlistInput } } } },
  responses: {
    201: jsonResponse(z.object({ status: z.literal("received") }), "Submission received"),
    400: protectedErrors[400],
    413: jsonResponse(errorEnvelope, "Request body too large"),
    429: limitedResponse,
    503: overloadedResponse,
    500: internalResponse,
  },
});
