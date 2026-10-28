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

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, "Must be exactly 6 digits")
  .openapi({ example: "482915", description: "6-digit Yen approval PIN" });

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

export const resetPinRequestInput = z.object({}).strict().openapi("ResetPinRequestInput");

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
  })
  .strict()
  .openapi("ExpenseApprovalInput");

export const expenseApprovalResponse = z
  .object({
    status: z.literal("approved"),
    expenseId: z.string().uuid(),
    approvedAt: z.iso.datetime(),
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
