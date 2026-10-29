import { createRoute, z } from "@hono/zod-openapi";
import { paiseWire } from "@yen/shared";
import { errorEnvelope } from "./errors.js";

const publicExpenseParams = z.object({
  fundId: z
    .string()
    .uuid()
    .openapi({ param: { name: "fundId", in: "path" } }),
  expenseId: z
    .string()
    .uuid()
    .openapi({ param: { name: "expenseId", in: "path" } }),
});

const requestIdHeader = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
    required: true,
  },
} as const;

const publicReadHeaders = {
  ...requestIdHeader,
  etag: { schema: { type: "string" as const }, description: "Representation validator" },
  "cache-control": {
    schema: { type: "string" as const },
    description: "Visibility-tier cache policy",
  },
};

const evidenceDownloadHeaders = {
  ...publicReadHeaders,
  "content-disposition": {
    schema: { type: "string" as const },
    description: "Forces evidence response to download as an attachment",
  },
  "x-content-type-options": {
    schema: { type: "string" as const, enum: ["nosniff"] },
    description: "Disables MIME sniffing",
  },
  "content-security-policy": {
    schema: { type: "string" as const },
    description: "Sandboxes the evidence response",
  },
};

const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  headers: requestIdHeader,
  content: { "application/json": { schema } },
});

const notFound = jsonResponse(errorEnvelope, "Unknown or inaccessible fund or expense");
const publicExpenseErrors = {
  400: jsonResponse(errorEnvelope, "Invalid fund or expense identifier"),
  404: notFound,
  429: jsonResponse(errorEnvelope, "Rate limit exceeded"),
  500: jsonResponse(errorEnvelope, "Internal failure"),
  503: jsonResponse(errorEnvelope, "Dependency unavailable"),
};

export const publicExpenseDetailSchema = z
  .object({
    expenseId: z.string().uuid(),
    fundId: z.string().uuid(),
    amountPaise: paiseWire,
    category: z.string(),
    status: z.enum(["draft", "submitted", "approved", "rejected", "expired", "paid", "reconciled"]),
    payeeName: z.string().optional(),
    requesterDisplayName: z.string().optional(),
    description: z.string().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .openapi("PublicExpenseDetail");

const publicExpenseProof = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    scanStatus: z.enum(["clean", "infected", "unavailable"]),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).optional(),
    contentBase64: z.string().base64().optional(),
  })
  .strict()
  .openapi("PublicExpenseProof");

export const publicExpenseProofsSchema = z
  .object({
    expenseId: z.string().uuid(),
    proofs: z.array(publicExpenseProof),
  })
  .strict()
  .openapi("PublicExpenseProofs");

export const publicExpenseDetailRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/expenses/{expenseId}",
  tags: ["public funds", "expenses"],
  operationId: "getPublicExpenseDetail",
  description:
    "Reads a policy-redacted expense detail for a fund tier. Anonymous public views receive no free-text identity fields.",
  request: { params: publicExpenseParams },
  responses: {
    200: {
      ...jsonResponse(publicExpenseDetailSchema, "Tier-filtered expense details"),
      headers: publicReadHeaders,
    },
    ...publicExpenseErrors,
  },
});

export const publicExpenseProofsRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/expenses/{expenseId}/proofs",
  tags: ["public funds", "expenses", "evidence"],
  operationId: "getPublicExpenseProofs",
  description:
    "Reads filename-free evidence metadata. Verified bill bytes are returned only to donor and member tiers.",
  request: { params: publicExpenseParams },
  responses: {
    200: {
      ...jsonResponse(publicExpenseProofsSchema, "Tier-filtered proof metadata and allowed files"),
      headers: evidenceDownloadHeaders,
    },
    ...publicExpenseErrors,
  },
});
