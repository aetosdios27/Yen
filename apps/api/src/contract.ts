import { createRoute, z } from "@hono/zod-openapi";
import { paiseWire } from "@yen/shared";
import { errorEnvelope } from "./errors.js";
import {
  fraudAcknowledgementSchema,
  fraudFlagSchema,
  payeeInputSchema,
  payeeOutputSchema,
} from "./payee-rules/schema.js";

export const responseHeaders = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
    required: true,
  },
  "x-trace-id": {
    schema: { type: "string", pattern: "^[0-9a-f]{32}$" },
    description: "OpenTelemetry trace ID, or request correlation ID when tracing is disabled",
    required: true,
  },
} as const;
export const replayHeader = {
  "idempotent-replayed": {
    schema: { type: "string" as const, enum: ["true"] },
    description: "Present on replay",
  },
};
export const retryHeader = {
  "retry-after": {
    schema: { type: "string" as const, pattern: "^[1-9][0-9]*$" },
    description: "Seconds until retry",
  },
};
const fundReadHeaders = {
  ...responseHeaders,
  etag: {
    schema: { type: "string" as const },
    description: "Representation validator for public-tier responses",
  },
  "cache-control": {
    schema: { type: "string" as const },
    description: "Public short shared cache; authenticated tiers are private and no-store",
  },
};

const cookieHeader = {
  "set-cookie": {
    schema: { type: "string" },
    description: "Session cookie for browser clients",
  },
} as const;

export function jsonResponse<T extends z.ZodType>(schema: T, description: string) {
  return { description, headers: responseHeaders, content: { "application/json": { schema } } };
}

function jsonCookieResponse<T extends z.ZodType>(schema: T, description: string) {
  return {
    description,
    headers: { ...responseHeaders, ...cookieHeader },
    content: { "application/json": { schema } },
  };
}

export function withReplay<T extends { headers: object }>(response: T) {
  return { ...response, headers: { ...response.headers, ...replayHeader } };
}

const internalResponse = jsonResponse(
  errorEnvelope,
  "Internal failure; no private error information",
);
const gatewayTimeoutResponse = jsonResponse(errorEnvelope, "Gateway timeout");
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
export const protectedErrors = {
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
  504: gatewayTimeoutResponse,
};
const security = [{ bearerAuth: [] }];

export const principalSchema = z
  .object({
    id: z.string().uuid(),
    phone: z.string().optional(),
    displayName: z.string().optional(),
    locale: z.string().optional(),
  })
  .openapi("Principal");
const payeeName = z.string().trim().min(1).max(80);
const upiVpa = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, "Expected a UPI ID such as club@bank");
const fundFields = {
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(500).optional(),
  targetPaise: paiseWire,
  upiVpa,
  upiPayeeName: payeeName,
};
const fundVisibility = z.enum(["public", "donors", "members", "private"]);
export const fundInput = z
  .object({ ...fundFields, visibility: fundVisibility.optional() })
  .strict()
  .openapi("CreateFund");
export const fundSchema = z
  .object({
    ...fundFields,
    visibility: fundVisibility,
    version: z.number().int().positive().optional(),
    id: z.string().uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .openapi("Fund");

const statusSchema = z.object({ status: z.literal("ok") });
const versionSchema = z
  .object({
    gitSha: z.string(),
    buildId: z.string(),
    artifactDigest: z.string(),
    releaseTag: z.string(),
    provenanceUrl: z.string(),
  })
  .strict()
  .openapi("Version");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "health",
  summary: "Liveness",
  responses: { 200: jsonResponse(statusSchema, "Process is alive"), 500: internalResponse },
});
export const versionRoute = createRoute({
  method: "get",
  path: "/version",
  operationId: "version",
  summary: "Build version",
  responses: {
    200: jsonResponse(
      versionSchema,
      "Source commit, deterministic build identifier, and optional release metadata",
    ),
  },
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
    504: protectedErrors[504],
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

export const changeFundVisibilityRoute = createRoute({
  method: "put",
  path: "/v1/funds/{fundId}/visibility",
  tags: ["funds", "policy"],
  operationId: "changeFundVisibility",
  security,
  description:
    "Changes fund visibility using an optimistic version and records the v2 audit event.",
  request: {
    params: z.object({ fundId: z.string().uuid() }),
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              visibility: z.enum(["public", "donors", "members", "private"]),
              expectedVersion: z.number().int().positive(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: withReplay(jsonResponse(fundSchema, "Fund visibility updated")),
    400: withReplay(protectedErrors[400]),
    401: withReplay(protectedErrors[401]),
    403: withReplay(protectedErrors[403]),
    404: withReplay(protectedErrors[404]),
    409: withReplay(protectedErrors[409]),
    500: withReplay(protectedErrors[500]),
  },
});

const publicFundIdParams = z.object({
  fundId: z
    .string()
    .uuid()
    .openapi({
      description: "Canonical FundId UUID; inaccessible funds return 404",
      param: { name: "fundId", in: "path" },
    }),
});
const verificationState = z.enum(["bank-matched", "anchored", "unverified"]);
const alertSeverity = z.enum(["info", "warning", "critical"]);
const alertTypeWire = z.enum([
  "unapproved_debit",
  "balance_drift",
  "chain_verification_failure",
  "anchor_missing",
  "anchor_mismatch",
  "repeated_rejected_requests",
  "spend_rate_spike",
  "integrity_check_failure",
]);
const publicTimelineItem = z.object({
  id: z.string().uuid(),
  occurredAt: z.iso.datetime(),
  message: z.string(),
  actorDisplayName: z.string().optional(),
  amountPaise: paiseWire.optional(),
  alertType: alertTypeWire.optional(),
  severity: alertSeverity.optional(),
  /** Alert title; present only for member-tier viewers. */
  title: z.string().optional(),
  verified: verificationState,
});
export const publicFundSummarySchema = z
  .object({
    fundId: z.string().uuid(),
    name: z.string(),
    purpose: z.string().nullable(),
    raisedPaise: paiseWire.nullable(),
    spentPaise: paiseWire,
    verification: verificationState,
    dataGaps: z.array(z.string()),
  })
  .strict();
export const publicFundBreakdownSchema = z
  .object({
    fundId: z.string().uuid(),
    categories: z.array(
      z
        .object({
          category: z.string(),
          spentPaise: paiseWire,
          transactionCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    dataGaps: z.array(z.string()),
  })
  .strict();
export const publicFundTimelineSchema = z
  .object({
    fundId: z.string().uuid(),
    items: z.array(publicTimelineItem),
    dataGaps: z.array(z.string()),
  })
  .strict();
const publicFundErrors = {
  404: protectedErrors[404],
  429: protectedErrors[429],
  500: protectedErrors[500],
  503: protectedErrors[503],
};
export const publicFundSummaryRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/summary",
  tags: ["public funds"],
  operationId: "getPublicFundSummary",
  request: { params: publicFundIdParams },
  responses: {
    200: {
      ...jsonResponse(publicFundSummarySchema, "Visibility-filtered fund summary"),
      headers: fundReadHeaders,
    },
    ...publicFundErrors,
  },
});
export const publicFundBreakdownRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/breakdown",
  tags: ["public funds"],
  operationId: "getPublicFundBreakdown",
  request: { params: publicFundIdParams },
  responses: {
    200: {
      ...jsonResponse(publicFundBreakdownSchema, "Visibility-filtered spend breakdown"),
      headers: fundReadHeaders,
    },
    ...publicFundErrors,
  },
});
export const publicFundTimelineRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/timeline",
  tags: ["public funds"],
  operationId: "getPublicFundTimeline",
  request: { params: publicFundIdParams },
  responses: {
    200: {
      ...jsonResponse(publicFundTimelineSchema, "Visibility-filtered plain language timeline"),
      headers: fundReadHeaders,
    },
    ...publicFundErrors,
  },
});

const consentPurpose = z.enum([
  "account_otp",
  "donation_receipt_contact",
  "notification_whatsapp",
  "notification_sms",
  "notification_email",
]);
const privacyConsentsResponse = z.object({
  consents: z.array(
    z.object({
      purpose: consentPurpose,
      noticeVersion: z.string(),
      grantedAt: z.iso.datetime(),
      withdrawnAt: z.iso.datetime().nullable(),
    }),
  ),
});
const privacyConsentInput = z
  .object({ purpose: consentPurpose, action: z.enum(["grant", "withdraw"]) })
  .strict();
const privacyStatusResponse = z.object({ status: z.literal("ok"), noticeVersion: z.string() });
export const getPrivacyConsentsRoute = createRoute({
  method: "get",
  path: "/v1/privacy/consents",
  operationId: "getPrivacyConsents",
  security,
  responses: {
    200: jsonResponse(
      privacyConsentsResponse,
      "Current and historical purpose-specific consent records",
    ),
    ...protectedErrors,
  },
});
export const updatePrivacyConsentRoute = createRoute({
  method: "post",
  path: "/v1/privacy/consents",
  operationId: "updatePrivacyConsent",
  security,
  request: {
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: { content: { "application/json": { schema: privacyConsentInput } } },
  },
  responses: {
    200: jsonResponse(privacyStatusResponse, "Consent recorded or withdrawn"),
    ...protectedErrors,
  },
});
const erasureInput = z.object({ dryRun: z.boolean().default(false) }).strict();
const erasureReport = z.object({
  status: z.enum(["preview", "completed"]),
  retained: z.boolean(),
  wouldErase: z.record(z.string(), z.number().int().nonnegative()),
  wouldRetain: z.record(z.string(), z.number().int().nonnegative()),
});
export const requestErasureRoute = createRoute({
  method: "post",
  path: "/v1/privacy/erasure-requests",
  operationId: "requestErasure",
  security,
  request: {
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: { content: { "application/json": { schema: erasureInput } } },
  },
  responses: {
    200: jsonResponse(erasureReport, "Erasure preview or completed request"),
    ...protectedErrors,
  },
});
const retentionInput = z
  .object({ userId: z.string().uuid(), reason: z.string().trim().min(10).max(1000) })
  .strict();
export const markRetentionRequiredRoute = createRoute({
  method: "post",
  path: "/v1/privacy/funds/{fundId}/retention-required",
  operationId: "markRetentionRequired",
  security,
  request: {
    params: z.object({ fundId: z.string().uuid() }),
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: { content: { "application/json": { schema: retentionInput } } },
  },
  responses: {
    204: { description: "Retention requirement recorded with an audit reason" },
    ...protectedErrors,
  },
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
    504: gatewayTimeoutResponse,
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
    504: gatewayTimeoutResponse,
  },
});

export const sendOtpInput = z
  .object({
    phone: z
      .string()
      .min(1)
      .openapi({ description: "Phone number (E.164 or 10-digit Indian mobile)" }),
    channel: z
      .enum(["whatsapp", "sms"])
      .openapi({ description: "Selected delivery channel; delivery never switches channels" }),
  })
  .strict()
  .openapi("SendOtpInput");

export const sendOtpResponse = z
  .object({
    status: z.literal("sent"),
    channel: z.enum(["whatsapp", "sms"]),
    resendAfterSeconds: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .openapi("SendOtpResponse");

export const verifyOtpInput = z
  .object({
    phone: z
      .string()
      .min(1)
      .openapi({ description: "Phone number (E.164 or 10-digit Indian mobile)" }),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .openapi({ description: "6-digit OTP code" }),
  })
  .strict()
  .openapi("VerifyOtpInput");

export const authUserSchema = z
  .object({
    id: z.string().uuid(),
    phone: z.string(),
    displayName: z.string(),
    locale: z.string(),
  })
  .strict()
  .openapi("AuthUser");

export const authSessionSchema = z
  .object({
    id: z.string().uuid(),
    token: z.string(),
    expiresAt: z.iso.datetime(),
    user: authUserSchema,
  })
  .strict()
  .openapi("AuthSession");

export const verifyOtpResponse = z
  .object({
    status: z.literal("authenticated"),
    session: authSessionSchema,
  })
  .strict()
  .openapi("VerifyOtpResponse");

export const rotateSessionResponse = z
  .object({
    status: z.literal("rotated"),
    session: z.object({
      id: z.string().uuid(),
      token: z.string(),
      expiresAt: z.iso.datetime(),
    }),
  })
  .strict()
  .openapi("RotateSessionResponse");

export const sessionItemSchema = z
  .object({
    id: z.string().uuid(),
    deviceInfo: z.string(),
    ip: z.string(),
    createdAt: z.iso.datetime(),
    lastActiveAt: z.iso.datetime(),
    isCurrent: z.boolean(),
  })
  .strict()
  .openapi("SessionItem");

export const listSessionsResponse = z
  .object({
    sessions: z.array(sessionItemSchema),
  })
  .strict()
  .openapi("ListSessionsResponse");

export const statusLoggedOut = z.object({ status: z.literal("logged_out") }).strict();
export const statusLoggedOutAll = z.object({ status: z.literal("logged_out_all") }).strict();
export const statusRevoked = z.object({ status: z.literal("revoked") }).strict();

export const sendOtpRoute = createRoute({
  method: "post",
  path: "/v1/auth/otp/send",
  operationId: "sendOtp",
  tags: ["auth"],
  description:
    "Send a 6-digit OTP through the selected WhatsApp or SMS channel; no fallback occurs.",
  request: { body: { required: true, content: { "application/json": { schema: sendOtpInput } } } },
  responses: {
    200: jsonResponse(sendOtpResponse, "OTP challenge dispatched"),
    400: protectedErrors[400],
    429: limitedResponse,
    500: internalResponse,
    503: overloadedResponse,
  },
});

export const verifyOtpRoute = createRoute({
  method: "post",
  path: "/v1/auth/otp/verify",
  operationId: "verifyOtp",
  tags: ["auth"],
  description:
    "Verify a 6-digit OTP, authenticate or register the user, and issue an httpOnly session cookie.",
  request: {
    body: { required: true, content: { "application/json": { schema: verifyOtpInput } } },
  },
  responses: {
    200: jsonCookieResponse(verifyOtpResponse, "Authenticated session created"),
    400: protectedErrors[400],
    429: limitedResponse,
    500: internalResponse,
    503: overloadedResponse,
  },
});

const ownerInviteParams = z.object({ fundId: z.string().uuid() });
export const createOwnerInviteRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/invites",
  tags: ["auth", "members"],
  operationId: "createOwnerInvite",
  security,
  request: {
    params: ownerInviteParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ phone: z.string() }).strict() } },
    },
  },
  responses: {
    201: jsonResponse(
      z.object({
        inviteId: z.string().uuid(),
        code: z.string().regex(/^[0-9a-f]{64}$/),
        expiresAt: z.iso.datetime(),
      }),
      "Single-use invite code; show as QR or pass in person",
    ),
    ...protectedErrors,
  },
});
export const listOwnerInvitesRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/invites",
  tags: ["auth", "members"],
  operationId: "listOwnerInvites",
  security,
  request: { params: ownerInviteParams },
  responses: {
    200: jsonResponse(
      z.object({
        invites: z.array(
          z.object({
            inviteId: z.string().uuid(),
            displayName: z.string().nullable(),
            phoneEnding: z.string().length(4),
            status: z.enum(["issued", "redeemed"]),
          }),
        ),
      }),
      "Owner invites awaiting confirmation",
    ),
    ...protectedErrors,
  },
});
export const confirmOwnerInviteRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/invites/{inviteId}/confirm",
  tags: ["auth", "members"],
  operationId: "confirmOwnerInvite",
  security,
  request: {
    params: z.object({ fundId: z.string().uuid(), inviteId: z.string().uuid() }),
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        status: z.literal("confirmed"),
        displayName: z.string(),
        phoneEnding: z.string().length(4),
      }),
      "Owner confirmed the in-person member",
    ),
    ...protectedErrors,
  },
});
export const redeemOwnerInviteRoute = createRoute({
  method: "post",
  path: "/v1/auth/invites/redeem",
  tags: ["auth"],
  operationId: "redeemOwnerInvite",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              code: z.string().regex(/^[0-9a-f]{64}$/),
              phone: z.string(),
              displayName: z.string().trim().min(1).max(80),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.union([
        z.object({ status: z.literal("pending_owner_confirmation") }),
        z.object({
          status: z.literal("authenticated"),
          session: z.object({
            id: z.string().uuid(),
            token: z.string(),
            expiresAt: z.iso.datetime(),
            user: z.object({
              id: z.string().uuid(),
              phone: z.string(),
              displayName: z.string(),
              locale: z.string(),
            }),
          }),
        }),
      ]),
      "Redeemed invite or completed sign-in",
    ),
    ...protectedErrors,
  },
});

export const rotateSessionRoute = createRoute({
  method: "post",
  path: "/v1/auth/session/rotate",
  operationId: "rotateSession",
  tags: ["auth"],
  security,
  description: "Rotates the active session token, invalidating the previous token.",
  responses: {
    200: jsonCookieResponse(rotateSessionResponse, "Session token rotated"),
    401: protectedErrors[401],
    500: internalResponse,
  },
});

export const getSessionsRoute = createRoute({
  method: "get",
  path: "/v1/auth/sessions",
  operationId: "getSessions",
  tags: ["auth"],
  security,
  description: "Lists active sessions and devices for the authenticated user.",
  responses: {
    200: jsonResponse(listSessionsResponse, "List of active user sessions"),
    401: protectedErrors[401],
    500: internalResponse,
  },
});

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, "Must be exactly 6 digits")
  .openapi({ example: "482915", description: "6-digit Yen approval PIN" });

export const unlockTrustedDeviceInput = z
  .object({ pin: pinSchema })
  .strict()
  .openapi("UnlockTrustedDeviceInput");

export const unlockTrustedDeviceResponse = z
  .object({ status: z.literal("unlocked") })
  .strict()
  .openapi("UnlockTrustedDeviceResponse");

export const unlockTrustedDeviceRoute = createRoute({
  method: "post",
  path: "/v1/auth/device/unlock",
  tags: ["auth", "device"],
  operationId: "unlockTrustedDevice",
  security,
  description:
    "Reauthenticates a phone-verified session with the Yen PIN and binds or refreshes its trusted-device record.",
  request: {
    body: { required: true, content: { "application/json": { schema: unlockTrustedDeviceInput } } },
  },
  responses: {
    200: jsonResponse(unlockTrustedDeviceResponse, "Trusted device unlocked"),
    400: protectedErrors[400],
    401: protectedErrors[401],
    429: protectedErrors[429],
    500: protectedErrors[500],
  },
});

export const lockTrustedDeviceRoute = createRoute({
  method: "post",
  path: "/v1/auth/device/lock",
  tags: ["auth", "device"],
  operationId: "lockTrustedDevice",
  security,
  description: "Ends the unlocked period for the current trusted device.",
  responses: {
    200: jsonResponse(z.object({ status: z.literal("locked") }).strict(), "Trusted device locked"),
    401: protectedErrors[401],
    500: protectedErrors[500],
  },
});

export const logoutRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout",
  operationId: "logout",
  tags: ["auth"],
  security,
  description: "Revokes current session and clears session cookie.",
  responses: {
    200: jsonCookieResponse(statusLoggedOut, "Session revoked"),
    401: protectedErrors[401],
    500: internalResponse,
  },
});

export const logoutAllRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout-all",
  operationId: "logoutAll",
  tags: ["auth"],
  security,
  description: "Revokes all sessions across all devices for the authenticated user.",
  responses: {
    200: jsonCookieResponse(statusLoggedOutAll, "All sessions revoked"),
    401: protectedErrors[401],
    500: internalResponse,
  },
});

export const revokeSessionRoute = createRoute({
  method: "delete",
  path: "/v1/auth/sessions/{sessionId}",
  operationId: "revokeSession",
  tags: ["auth"],
  security,
  description: "Revokes a specific session belonging to the authenticated user.",
  request: {
    params: z.object({
      sessionId: z
        .string()
        .uuid()
        .openapi({
          description: "Session UUID to revoke",
          param: { name: "sessionId", in: "path" },
        }),
    }),
  },
  responses: {
    200: jsonCookieResponse(statusRevoked, "Session revoked"),
    401: protectedErrors[401],
    404: protectedErrors[404],
    500: internalResponse,
  },
});

export const pinSetupInput = z
  .object({
    pin: pinSchema,
  })
  .strict()
  .openapi("PinSetupInput");

export const pinSetupResponse = z
  .object({
    status: z.literal("created"),
    isSet: z.literal(true),
  })
  .strict()
  .openapi("PinSetupResponse");

export const setupPinRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/setup",
  tags: ["auth", "pin"],
  operationId: "setupApprovalPin",
  security,
  description: "Sets the 6-digit approval PIN for the principal before first approval action.",
  request: {
    body: { required: true, content: { "application/json": { schema: pinSetupInput } } },
  },
  responses: {
    201: jsonResponse(pinSetupResponse, "Approval PIN configured"),
    ...protectedErrors,
  },
});

export const pinStatusSchema = z
  .object({
    isSet: z.boolean(),
    status: z.enum(["not_set", "active", "locked_out", "cooling_off", "rate_limited"]),
    lockedUntil: z.string().nullable().optional(),
    coolingOffUntil: z.string().nullable().optional(),
    failedAttempts: z.number().int().nonnegative().optional(),
  })
  .strict()
  .openapi("PinStatus");

export const getPinStatusRoute = createRoute({
  method: "get",
  path: "/v1/auth/pin/status",
  tags: ["auth", "pin"],
  operationId: "getApprovalPinStatus",
  security,
  description: "Returns the approval PIN status for the principal.",
  responses: {
    200: jsonResponse(pinStatusSchema, "Current approval PIN status"),
    ...protectedErrors,
  },
});

export const verifyPinInput = z
  .object({
    pin: pinSchema,
    actionHash: z.string().regex(/^[0-9a-f]{64}$/, "Must be a 64-character hex hash"),
  })
  .strict()
  .openapi("VerifyPinInput");

export const verifyPinResponse = z
  .object({
    approvalToken: z.string().uuid(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .openapi("VerifyPinResponse");

export const verifyPinRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/verify",
  tags: ["auth", "pin"],
  operationId: "verifyApprovalPin",
  security,
  description:
    "Verifies the 6-digit approval PIN against a specific action hash and issues a single-use 60-second approval token.",
  request: {
    body: { required: true, content: { "application/json": { schema: verifyPinInput } } },
  },
  responses: {
    200: jsonResponse(verifyPinResponse, "PIN verified and approval token issued"),
    ...protectedErrors,
  },
});

export const changePinInput = z
  .object({
    currentPin: pinSchema,
    newPin: pinSchema,
  })
  .strict()
  .openapi("ChangePinInput");

export const changePinResponse = z
  .object({
    status: z.literal("updated"),
  })
  .strict()
  .openapi("ChangePinResponse");

export const changePinRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/change",
  tags: ["auth", "pin"],
  operationId: "changeApprovalPin",
  security,
  description: "Changes the approval PIN given the verified current PIN.",
  request: {
    body: { required: true, content: { "application/json": { schema: changePinInput } } },
  },
  responses: {
    200: jsonResponse(changePinResponse, "Approval PIN updated"),
    ...protectedErrors,
  },
});

export const resetPinRequestInput = z
  .object({ channel: z.enum(["whatsapp", "sms"]) })
  .strict()
  .openapi("ResetPinRequestInput");

export const resetPinRequestResponse = z
  .object({
    status: z.literal("otp_sent"),
    challengeId: z.string().uuid(),
  })
  .strict()
  .openapi("ResetPinRequestResponse");

export const requestPinResetRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/reset/request",
  tags: ["auth", "pin"],
  operationId: "requestPinReset",
  security,
  description: "Requests an OTP to reset a forgotten or locked PIN.",
  request: {
    body: { required: true, content: { "application/json": { schema: resetPinRequestInput } } },
  },
  responses: {
    200: jsonResponse(resetPinRequestResponse, "OTP challenge initiated"),
    ...protectedErrors,
  },
});

export const resetPinConfirmInput = z
  .object({
    otp: z.string().trim().min(1).max(10),
    newPin: pinSchema,
    challengeId: z.string().uuid().optional(),
  })
  .strict()
  .openapi("ResetPinConfirmInput");

export const resetPinConfirmResponse = z
  .object({
    status: z.literal("cooling_off"),
    coolingOffUntil: z.iso.datetime(),
  })
  .strict()
  .openapi("ResetPinConfirmResponse");

export const confirmPinResetRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/reset/confirm",
  tags: ["auth", "pin"],
  operationId: "confirmPinReset",
  security,
  description:
    "Confirms PIN reset with OTP, setting a 24-hour cooling-off during which approval actions are blocked.",
  request: {
    body: { required: true, content: { "application/json": { schema: resetPinConfirmInput } } },
  },
  responses: {
    200: jsonResponse(resetPinConfirmResponse, "PIN reset into 24-hour cooling-off period"),
    ...protectedErrors,
  },
});

export const unlockPinInput = z
  .object({
    targetUserId: z.string().uuid(),
  })
  .strict()
  .openapi("UnlockPinInput");

export const unlockPinResponse = z
  .object({
    status: z.literal("unlocked"),
  })
  .strict()
  .openapi("UnlockPinResponse");

export const unlockPinRoute = createRoute({
  method: "post",
  path: "/v1/auth/pin/unlock",
  tags: ["auth", "pin"],
  operationId: "unlockApprovalPin",
  security,
  description:
    "Allows an authorized administrator or recovery capability to unlock a locked-out approver PIN.",
  request: {
    body: { required: true, content: { "application/json": { schema: unlockPinInput } } },
  },
  responses: {
    200: jsonResponse(unlockPinResponse, "Approver PIN unlocked"),
    ...protectedErrors,
  },
});

export const expenseApprovalInput = z
  .object({
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
    deviceProof: z.string().uuid().optional(),
    credentialId: z.string().min(1).max(256).optional(),
    signatureHex: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .optional(),
    clientDataJson: z.string().min(1).optional(),
    authenticatorDataHex: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .optional(),
  })
  .strict()
  .openapi("ExpenseApprovalInput");

export const expenseApprovalResponse = z
  .object({
    status: z.enum(["submitted", "approved"]),
    expenseId: z.string().uuid(),
    approvedAt: z.iso.datetime().nullable(),
    approvalsCount: z.number().int().nonnegative().optional(),
  })
  .strict()
  .openapi("ExpenseApprovalResponse");

export const approveExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/approve",
  tags: ["approvals", "expenses"],
  operationId: "approveExpense",
  security,
  description:
    "Approves an expense spend request. Requires 6-digit approval PIN verification or valid approval token bound to this action.",
  request: {
    params: z.object({
      fundId: z.string().uuid(),
      expenseId: z.string().uuid(),
    }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: false,
      content: { "application/json": { schema: expenseApprovalInput } },
    },
  },
  responses: {
    200: withReplay(jsonResponse(expenseApprovalResponse, "Expense approved")),
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

export const expenseRejectionInput = z
  .object({
    reason: z.enum(["quorum", "objection", "policy"]).default("policy"),
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
    deviceProof: z.string().uuid().optional(),
  })
  .strict()
  .openapi("ExpenseRejectionInput");

export const expenseRejectionResponse = z
  .object({
    status: z.literal("rejected"),
    expenseId: z.string().uuid(),
    reason: z.string(),
    rejectedAt: z.iso.datetime(),
  })
  .strict()
  .openapi("ExpenseRejectionResponse");

export const rejectExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/reject",
  tags: ["approvals", "expenses"],
  operationId: "rejectExpense",
  security,
  description:
    "Rejects an expense spend request. Requires 6-digit approval PIN verification or valid approval token bound to this action.",
  request: {
    params: z.object({
      fundId: z.string().uuid(),
      expenseId: z.string().uuid(),
    }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: false,
      content: { "application/json": { schema: expenseRejectionInput } },
    },
  },
  responses: {
    200: withReplay(jsonResponse(expenseRejectionResponse, "Expense rejected")),
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

export const payeeChangeInput = z
  .object({
    vpa: z.string().trim().min(3).max(100),
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
  })
  .strict()
  .openapi("PayeeChangeInput");

export const payeeChangeResponse = z
  .object({
    status: z.literal("updated"),
    vpa: z.string(),
  })
  .strict()
  .openapi("PayeeChangeResponse");

export const changePayeeRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/payee",
  tags: ["approvals", "payee"],
  operationId: "changeFundPayee",
  security,
  description: "Changes the club's payee UPI ID. Requires 6-digit approval PIN verification.",
  request: {
    params: z.object({ fundId: z.string().uuid() }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: payeeChangeInput } },
    },
  },
  responses: {
    200: withReplay(jsonResponse(payeeChangeResponse, "Payee updated")),
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

export const policyChangeInput = z
  .object({
    policyJson: z.record(z.string(), z.unknown()),
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
  })
  .strict()
  .openapi("PolicyChangeInput");

export const policyChangeResponse = z
  .object({
    status: z.literal("updated"),
    policyJson: z.record(z.string(), z.unknown()),
  })
  .strict()
  .openapi("PolicyChangeResponse");

export const changePolicyRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/policy",
  tags: ["approvals", "policy"],
  operationId: "changeFundPolicy",
  security,
  description: "Changes the fund approval policy. Requires 6-digit approval PIN verification.",
  request: {
    params: z.object({ fundId: z.string().uuid() }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: policyChangeInput } },
    },
  },
  responses: {
    200: withReplay(jsonResponse(policyChangeResponse, "Policy updated")),
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

export const addMemberInput = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(["approver", "treasurer", "member"]),
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
  })
  .strict()
  .openapi("AddMemberInput");

export const addMemberResponse = z
  .object({
    status: z.literal("added"),
    memberId: z.string().uuid(),
    role: z.string(),
  })
  .strict()
  .openapi("AddMemberResponse");

export const addMemberRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/members",
  tags: ["approvals", "members"],
  operationId: "addFundMember",
  security,
  description:
    "Adds a new member or approver to the fund. Requires 6-digit approval PIN verification.",
  request: {
    params: z.object({ fundId: z.string().uuid() }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: addMemberInput } },
    },
  },
  responses: {
    201: withReplay(jsonResponse(addMemberResponse, "Member added")),
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

export const removeMemberInput = z
  .object({
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
  })
  .strict()
  .openapi("RemoveMemberInput");

export const removeMemberResponse = z
  .object({
    status: z.literal("removed"),
    memberId: z.string().uuid(),
  })
  .strict()
  .openapi("RemoveMemberResponse");

export const removeMemberRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/members/{memberId}/remove",
  tags: ["approvals", "members"],
  operationId: "removeFundMember",
  security,
  description: "Removes a member from the fund. Requires 6-digit approval PIN verification.",
  request: {
    params: z.object({
      fundId: z.string().uuid(),
      memberId: z.string().uuid(),
    }),
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
      "X-Approval-Token": z.string().uuid().optional(),
      "X-Approval-Pin": pinSchema.optional(),
    }),
    body: {
      required: false,
      content: { "application/json": { schema: removeMemberInput } },
    },
  },
  responses: {
    200: withReplay(jsonResponse(removeMemberResponse, "Member removed")),
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

const fundIdParam = z.object({
  fundId: z.string().openapi({
    description: "Canonical lowercase FundId UUID; invalid IDs return 404",
    param: { name: "fundId", in: "path" },
  }),
});
const publicErrors = {
  404: protectedErrors[404],
  429: limitedResponse,
  500: internalResponse,
  503: overloadedResponse,
};

/** Public donors are not signed in, so money details travel through policy redaction. */
export const donationDetailsSchema = z
  .object({
    fundId: z.string().uuid(),
    title: z.string(),
    upiVpa: z.string(),
    upiPayeeName: z.string(),
  })
  .strict()
  .openapi("DonationDetails");

export const donationDetailsRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/donation-details",
  tags: ["donations"],
  operationId: "getDonationDetails",
  description:
    "Public where-to-pay details for a fund: its UPI ID and the name to show the donor. Anyone may read them; an unknown or closed fund returns 404.",
  request: { params: fundIdParam },
  responses: {
    200: jsonResponse(donationDetailsSchema, "Where to send a donation"),
    ...publicErrors,
  },
});

const donationAmount = paiseWire.refine(
  (value) => value.length <= 15 && Number.isSafeInteger(Number(value)) && Number(value) > 0,
  "Expected a positive whole number of paise",
);

export const donationPledgeInput = z
  .object({
    amountPaise: donationAmount,
    utr: z
      .string()
      .regex(/^[0-9]{12}$/, "A UPI reference is exactly 12 digits")
      .openapi({ description: "The 12-digit reference shown in the donor's UPI app" }),
    donorName: z.string().trim().min(1).max(60).optional(),
    donorContact: contact.optional(),
    donorNameChoice: z.enum(["full", "initials", "anonymous"]).default("initials"),
  })
  .strict()
  .openapi("DonationPledge");

export const donationPledgeSchema = z
  .object({
    donationId: z.string().uuid(),
    fundId: z.string().uuid(),
    status: z.literal("pledged"),
    amountPaise: paiseWire,
  })
  .strict()
  .openapi("DonationPledgeResult");

export const pledgeDonationRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/donations/pledge",
  tags: ["donations"],
  operationId: "pledgeDonation",
  description:
    "Records a donor's self-reported UPI payment. The money is not spendable until a bank statement confirms it, and one 12-digit reference can only be claimed once, so a repeat returns 409. Requires Idempotency-Key; identical requests replay.",
  request: {
    params: fundIdParam,
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: { required: true, content: { "application/json": { schema: donationPledgeInput } } },
  },
  responses: {
    201: withReplay(jsonResponse(donationPledgeSchema, "Pledge recorded")),
    400: protectedErrors[400],
    404: protectedErrors[404],
    409: jsonResponse(errorEnvelope, "Reference already claimed, or idempotency conflict"),
    413: jsonResponse(errorEnvelope, "Request body too large"),
    429: limitedResponse,
    500: internalResponse,
    503: overloadedResponse,
  },
});

export const expenseStatusSchema = z
  .enum(["draft", "submitted", "approved", "rejected", "expired", "paid", "reconciled"])
  .openapi("ExpenseStatus");

export const expenseEvidenceSchema = z
  .object({
    evidenceId: z.string().uuid(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .openapi("ExpenseEvidence");

export const createExpenseInput = z
  .object({
    amountPaise: paiseWire,
    category: z
      .enum(["Equipment", "Travel", "Catering", "Logistics", "Facilities", "Other"])
      .optional(),
    description: bounded(500),
    recipientRef: bounded(128),
    payee: payeeInputSchema.optional(),
    invoiceNumber: bounded(128).optional(),
    evidence: z.array(expenseEvidenceSchema).optional(),
    supersedesId: z.string().uuid().optional(),
  })
  .strict()
  .openapi("CreateExpenseInput");

export const expenseSchema = z
  .object({
    id: z.string().uuid(),
    fundId: z.string().uuid(),
    requesterId: z.string(),
    amountPaise: paiseWire,
    category: z.enum(["Equipment", "Travel", "Catering", "Logistics", "Facilities", "Other"]),
    description: z.string(),
    recipientRef: z.string(),
    payee: payeeOutputSchema.nullable().optional(),
    fraudFlags: z.array(fraudFlagSchema).optional(),
    fraudAcknowledgements: z.array(fraudAcknowledgementSchema).optional(),
    status: expenseStatusSchema,
    holdId: z.string().nullable(),
    approvalsCount: z.number().int().min(0),
    objectionWindowOpen: z.boolean().optional(),
    supersedesId: z.string().uuid().nullable(),
    submittedAt: z.iso.datetime().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    rejectedAt: z.iso.datetime().nullable(),
    rejectionReason: z.enum(["quorum", "objection", "policy"]).nullable(),
    expiredAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
    reconciledAt: z.iso.datetime().nullable(),
    bankTransactionId: z.string().uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .openapi("Expense");

export const passkeySignatureInput = z
  .object({
    credentialId: z.string().min(1).max(256),
    signatureHex: z.string().regex(/^[0-9a-f]+$/),
    clientDataJson: z.string().min(1),
    authenticatorDataHex: z.string().regex(/^[0-9a-f]+$/),
  })
  .strict()
  .openapi("PasskeySignatureInput");

export const rejectExpenseInput = z
  .object({
    reason: z.enum(["quorum", "objection", "policy"]),
  })
  .strict()
  .openapi("RejectExpenseInput");

export const payExpenseInput = z
  .object({
    bankTransactionId: z.string().uuid(),
    approvalToken: z.string().uuid().optional(),
    pin: pinSchema.optional(),
    deviceProof: z.string().uuid().optional(),
  })
  .strict()
  .openapi("PayExpenseInput");

export const reconcileExpenseInput = z
  .object({
    bankTransactionId: z.string().uuid(),
  })
  .strict()
  .openapi("ReconcileExpenseInput");

export const createExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses",
  tags: ["expenses"],
  operationId: "createExpense",
  security,
  description:
    "Creates a new draft expense request for a fund. Money is nonnegative integer paise encoded as decimal string. Requires Idempotency-Key.",
  request: {
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
    }),
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({
          description: "Canonical lowercase FundId UUID",
          param: { name: "fundId", in: "path" },
        }),
    }),
    body: { required: true, content: { "application/json": { schema: createExpenseInput } } },
  },
  responses: {
    201: withReplay(jsonResponse(expenseSchema, "Draft expense created")),
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

export const getExpenseRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/expenses/{expenseId}",
  tags: ["expenses"],
  operationId: "getExpense",
  security,
  description: "Reads an expense request. Unauthorized requests return 404.",
  request: {
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
      expenseId: z
        .string()
        .uuid()
        .openapi({ param: { name: "expenseId", in: "path" } }),
    }),
  },
  responses: { 200: jsonResponse(expenseSchema, "Expense details"), ...protectedErrors },
});

export const listExpensesRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/expenses",
  tags: ["expenses"],
  operationId: "listExpenses",
  security,
  description: "Lists expense requests for a fund.",
  request: {
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
    }),
  },
  responses: { 200: jsonResponse(z.array(expenseSchema), "List of expenses"), ...protectedErrors },
});

export const submitExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/submit",
  tags: ["expenses"],
  operationId: "submitExpense",
  security,
  description:
    "Submits a draft expense request, creating a ledger hold to reserve funds. Transitions draft -> submitted. Emits expense.submitted event.",
  request: {
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
    }),
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
      expenseId: z
        .string()
        .uuid()
        .openapi({ param: { name: "expenseId", in: "path" } }),
    }),
  },
  responses: {
    200: withReplay(jsonResponse(expenseSchema, "Expense submitted and funds reserved via hold")),
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

export const payExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/pay",
  tags: ["expenses"],
  operationId: "payExpense",
  security,
  description:
    "Commits/settles the ledger hold for an approved expense after payment. Transitions approved -> paid. Emits expense.paid event.",
  request: {
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
    }),
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
      expenseId: z
        .string()
        .uuid()
        .openapi({ param: { name: "expenseId", in: "path" } }),
    }),
    body: { required: true, content: { "application/json": { schema: payExpenseInput } } },
  },
  responses: {
    200: withReplay(jsonResponse(expenseSchema, "Expense paid and hold settled")),
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

export const reconcileExpenseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/reconcile",
  tags: ["expenses"],
  operationId: "reconcileExpense",
  security,
  description:
    "Reconciles a paid expense against bank debit verification. Transitions paid -> reconciled. Emits bank.debit_seen event.",
  request: {
    headers: z.object({
      "Idempotency-Key": idempotencyKey,
    }),
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
      expenseId: z
        .string()
        .uuid()
        .openapi({ param: { name: "expenseId", in: "path" } }),
    }),
    body: { required: true, content: { "application/json": { schema: reconcileExpenseInput } } },
  },
  responses: {
    200: withReplay(jsonResponse(expenseSchema, "Expense reconciled")),
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

const alertIdParams = z.object({
  fundId: z
    .string()
    .uuid()
    .openapi({ param: { name: "fundId", in: "path" } }),
  alertId: z
    .string()
    .uuid()
    .openapi({ param: { name: "alertId", in: "path" } }),
});
export const fundAlertSchema = z
  .object({
    id: z.string().uuid(),
    alertType: alertTypeWire,
    severity: alertSeverity,
    status: z.enum(["open", "acknowledged", "resolved"]),
    title: z.string(),
    details: z.string(),
    createdAt: z.iso.datetime(),
    acknowledgedAt: z.iso.datetime().nullable(),
    resolvedAt: z.iso.datetime().nullable(),
    escalatedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .openapi("FundAlert");
export const alertNoteInput = z
  .object({
    note: z.string().trim().min(1).max(1000),
  })
  .strict()
  .openapi("AlertNoteInput");
const alertListQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ description: "Page size, 1 to 100" }),
  before: z.iso
    .datetime()
    .optional()
    .openapi({ description: "Exclusive created_at cursor: return alerts older than this" }),
});

export const listFundAlertsRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/alerts",
  tags: ["alerts"],
  operationId: "listFundAlerts",
  security,
  description: "Lists alerts for a fund, newest first. Fund members only.",
  request: {
    params: z.object({
      fundId: z
        .string()
        .uuid()
        .openapi({ param: { name: "fundId", in: "path" } }),
    }),
    query: alertListQuery,
  },
  responses: {
    200: jsonResponse(z.array(fundAlertSchema), "Fund alerts, newest first"),
    ...protectedErrors,
  },
});

function alertActionRoute(action: "acknowledge" | "resolve", description: string) {
  return createRoute({
    method: "post",
    path: `/v1/funds/{fundId}/alerts/{alertId}/${action}`,
    tags: ["alerts"],
    operationId: `${action}Alert`,
    security,
    description,
    request: {
      params: alertIdParams,
      headers: z.object({ "Idempotency-Key": idempotencyKey }),
      body: { required: true, content: { "application/json": { schema: alertNoteInput } } },
    },
    responses: {
      200: withReplay(jsonResponse(fundAlertSchema, `Alert ${action}d`)),
      ...protectedErrors,
    },
  });
}

export const acknowledgeAlertRoute = alertActionRoute(
  "acknowledge",
  "Acknowledges an open alert with a required note. Fund owners and approvers only.",
);
export const resolveAlertRoute = alertActionRoute(
  "resolve",
  "Resolves an open or acknowledged alert with a required note. Resolved alerts cannot be reopened. Fund owners and approvers only.",
);

export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const MAX_EVIDENCE_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const evidenceSchema = z
  .object({
    evidenceId: z
      .string()
      .uuid()
      .openapi({ description: "Unique identifier for this evidence upload" }),
    fundId: z.string().uuid(),
    expenseId: z.string().uuid(),
    fileSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .openapi({ description: "SHA-256 hash computed by the server from the uploaded bytes" }),
    mimeType: z
      .enum(ALLOWED_EVIDENCE_MIME_TYPES)
      .openapi({ description: "MIME type of uploaded file" }),
    fileSizeBytes: z.number().int().min(1).max(MAX_EVIDENCE_FILE_SIZE_BYTES),
    fileName: z.string().min(1).max(120),
    duplicateDetected: z
      .boolean()
      .openapi({ description: "Identical bytes were attached to another expense in this fund" }),
    isDuplicate: z.boolean().openapi({ description: "Alias for duplicateDetected" }),
    duplicateExpenseId: z
      .string()
      .uuid()
      .optional()
      .openapi({ description: "Expense ID of the prior duplicate in this fund, when present" }),
    vendorName: z.string().optional(),
    gstin: z.string().optional(),
    invoiceNumber: z.string().optional(),
    invoiceDate: z.string().optional(),
    scan: z
      .object({ scannerName: z.string(), signatureVersion: z.string(), result: z.literal("clean") })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const evidenceForm = z
  .object({
    file: z.any().openapi({
      type: "string",
      format: "binary",
      description: "Evidence document (max 10MB; JPEG, PNG, WebP, PDF)",
    }),
    vendorName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .openapi({ description: "Optional merchant or vendor name" }),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .openapi({ description: "Optional 15-character Indian GSTIN; validated by the API" }),
    invoiceNumber: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .openapi({ description: "Optional invoice or receipt reference number" }),
    invoiceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .openapi({ description: "Optional invoice issue date (YYYY-MM-DD)" }),
  })
  .openapi("UploadEvidenceInput");
const evidenceParams = z.object({
  fundId: z.string().openapi({
    description: "Canonical lowercase FundId UUID; invalid IDs return 404",
    param: { name: "fundId", in: "path" },
  }),
  expenseId: z.string().openapi({
    description: "Canonical lowercase ExpenseId UUID; invalid IDs return 404",
    param: { name: "expenseId", in: "path" },
  }),
});
export const uploadEvidenceRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/evidence",
  tags: ["expenses", "evidence"],
  operationId: "uploadEvidence",
  description:
    "Uploads bill or receipt evidence after malware scanning. Computes SHA-256 server-side, validates GSTIN and MIME type, enforces the 10MB limit, and detects duplicates within the fund. Scanner errors and infected files fail closed.",
  security,
  request: {
    params: evidenceParams,
    body: { required: true, content: { "multipart/form-data": { schema: evidenceForm } } },
  },
  responses: {
    201: jsonResponse(evidenceSchema, "Evidence stored with a server-computed hash"),
    ...protectedErrors,
    413: jsonResponse(errorEnvelope, "Evidence body exceeds the upload size limit of 10MB"),
  },
});
export const getEvidenceRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/evidence",
  tags: ["expenses", "evidence"],
  operationId: "getEvidence",
  description:
    "Retrieves evidence attached to an expense after verifying stored bytes against their pinned SHA-256 hashes.",
  security,
  request: { params: evidenceParams },
  responses: {
    200: jsonResponse(z.object({ evidence: z.array(evidenceSchema) }).strict(), "Evidence list"),
    ...protectedErrors,
  },
});

export const statementTransactionSummarySchema = z
  .object({
    id: z.string(),
    bankReference: z.string(),
    utr: z.string().optional(),
    amountPaise: paiseWire,
    type: z.enum(["credit", "debit"]),
    reconciliationStatus: z.enum([
      "unmatched",
      "matched",
      "manually_matched",
      "ignored",
      "ambiguous",
    ]),
    matchedPledgeId: z.string().optional(),
    duplicate: z.boolean().optional(),
  })
  .strict()
  .openapi("StatementTransactionSummary");

export const statementUploadResultSchema = z
  .object({
    totalProcessed: z.number().int().nonnegative(),
    ingestedCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    transactions: z.array(statementTransactionSummarySchema),
  })
  .strict()
  .openapi("StatementUploadResult");

export const statementUploadInput = z
  .object({
    fundId: z.string().uuid(),
    csvContent: z.string().min(1),
  })
  .strict()
  .openapi("StatementUploadInput");

export const statementUploadRoute = createRoute({
  method: "post",
  path: "/v1/reconciliation/statements",
  tags: ["reconciliation"],
  operationId: "uploadStatement",
  security,
  summary: "Upload bank statement CSV",
  description:
    "Uploads and ingests a bank statement CSV for reconciliation against pending donation pledges.",
  request: {
    body: { required: true, content: { "application/json": { schema: statementUploadInput } } },
  },
  responses: {
    200: jsonResponse(statementUploadResultSchema, "Statement parsed and ingested"),
    ...protectedErrors,
  },
});

export const partnerWebhookResultSchema = z
  .object({
    status: z.literal("processed"),
    duplicate: z.boolean().optional(),
    transactionId: z.string(),
    reconciliationStatus: z.enum([
      "unmatched",
      "matched",
      "manually_matched",
      "ignored",
      "ambiguous",
    ]),
    matchedPledgeId: z.string().optional(),
  })
  .strict()
  .openapi("PartnerWebhookResult");

export const partnerWebhookInput = z
  .object({
    event: z.string().min(1).max(100),
    timestamp: z.string().datetime(),
    data: z
      .object({
        fund_id: z.string().uuid(),
        bank_reference: z.string().trim().min(1).max(128),
        amount_paise: z.union([
          z.number().int().positive(),
          z
            .string()
            .regex(/^[1-9][0-9]*$/)
            .refine(
              (v) => Number.isSafeInteger(Number(v)),
              "Amount exceeds the safe integer range",
            ),
        ]),
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
  .strict()
  .openapi("PartnerWebhookInput");

export const partnerWebhookRoute = createRoute({
  method: "post",
  path: "/v1/reconciliation/webhooks/partner",
  tags: ["reconciliation"],
  operationId: "partnerWebhook",
  summary: "Payment partner webhook",
  description:
    "Idempotent webhook receiver for payment partner notifications (e.g. UPI virtual account credit). Requests must carry `X-Webhook-Timestamp` (Unix seconds, within five minutes of server time) and `X-Webhook-Signature`, the lowercase hex HMAC-SHA256 of `v1.<timestamp>.<raw body>` under the shared partner secret. Unsigned, stale, future-dated, or tampered requests are rejected with 401 before the body is parsed.",
  request: {
    body: { required: true, content: { "application/json": { schema: partnerWebhookInput } } },
  },
  responses: {
    200: jsonResponse(partnerWebhookResultSchema, "Webhook processed"),
    400: protectedErrors[400],
    401: protectedErrors[401],
    404: protectedErrors[404],
    429: limitedResponse,
    500: internalResponse,
    503: overloadedResponse,
  },
});

export const candidatePledgeSchema = z
  .object({
    pledgeId: z.string(),
    amountPaise: paiseWire,
    utr: z.string(),
    donorName: z.string().optional(),
    createdAt: z.string().datetime(),
    timeDifferenceHours: z.number().int().nonnegative(),
  })
  .strict()
  .openapi("CandidatePledge");

export const unmatchedCreditSchema = z
  .object({
    id: z.string(),
    fundId: z.string().uuid(),
    bankReference: z.string(),
    utr: z.string().optional(),
    amountPaise: paiseWire,
    postedAt: z.string().datetime(),
    narration: z.string().optional(),
    counterpartyVpa: z.string().optional(),
    candidates: z.array(candidatePledgeSchema),
  })
  .strict()
  .openapi("UnmatchedCredit");

export const unmatchedCreditsSchema = z
  .array(unmatchedCreditSchema)
  .openapi("UnmatchedCreditsResponse");

export const unmatchedCreditsRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/reconciliation/unmatched",
  tags: ["reconciliation"],
  operationId: "getUnmatchedCredits",
  security,
  summary: "Treasurer review queue for unmatched credits",
  description:
    "Lists unmatched bank credits for a fund with potential matching candidate pledges for treasurer review.",
  request: { params: fundIdParam },
  responses: {
    200: jsonResponse(unmatchedCreditsSchema, "Queue of unmatched credits"),
    ...protectedErrors,
  },
});

export const manualMatchInput = z
  .object({
    bankTransactionId: z
      .string()
      .min(1)
      .openapi({ description: "ID of the unmatched bank transaction" }),
    pledgeId: z.string().min(1).openapi({ description: "ID of the pledge to match" }),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .openapi({ description: "Audit reason for manual match by treasurer" }),
  })
  .strict()
  .openapi("ManualMatchInput");

export const manualMatchResultSchema = z
  .object({
    status: z.literal("matched"),
    bankTransactionId: z.string(),
    pledgeId: z.string(),
    amountPaise: paiseWire,
    matchedAt: z.string().datetime(),
  })
  .strict()
  .openapi("ManualMatchResult");

export const manualMatchRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/reconciliation/manual-match",
  tags: ["reconciliation"],
  operationId: "manualMatch",
  security,
  summary: "Treasurer manual reconciliation match",
  description:
    "Manually matches an unmatched bank transaction with a donation pledge with mandatory audit reason.",
  request: {
    params: fundIdParam,
    headers: z.object({ "Idempotency-Key": idempotencyKey }),
    body: { required: true, content: { "application/json": { schema: manualMatchInput } } },
  },
  responses: {
    200: withReplay(jsonResponse(manualMatchResultSchema, "Manual match successful")),
    400: protectedErrors[400],
    401: protectedErrors[401],
    403: protectedErrors[403],
    404: protectedErrors[404],
    409: jsonResponse(errorEnvelope, "Transaction or pledge already matched"),
    429: limitedResponse,
    500: internalResponse,
    503: overloadedResponse,
  },
});
