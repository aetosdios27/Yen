import { z } from "@hono/zod-openapi";

export const errorCode = z.enum([
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "rate_limited",
  "internal",
]);

export const errorStatus = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<z.infer<typeof errorCode>, number>;

export type ErrorCode = keyof typeof errorStatus;

const messages: Record<ErrorCode, string> = {
  validation_failed: "Request validation failed",
  unauthenticated: "Authentication required",
  forbidden: "Access denied",
  not_found: "Resource not found",
  conflict: "Resource conflict",
  idempotency_conflict: "Idempotency key already used or in progress",
  rate_limited: "Rate limit exceeded",
  internal: "Internal server error",
};

export const validationDetail = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export const errorEnvelope = z
  .object({
    error: z.object({
      code: errorCode,
      message: z.string(),
      requestId: z.string().uuid(),
      details: z.array(validationDetail).optional(),
    }),
  })
  .openapi("ErrorEnvelope");

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: z.infer<typeof validationDetail>[],
  ) {
    super(messages[code]);
  }
}

export class ReadinessError extends Error {
  constructor() {
    super("Readiness failed");
  }
}

export class StoreError extends Error {
  constructor() {
    super("Store failed");
  }
}

export function errorBody(error: ApiError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: messages[error.code],
      requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
