import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ApiEnv, Principal } from "../dependencies.js";
import { ApiError } from "../errors.js";
import type { ExistingFundResource } from "../policy.js";
import type { ReconciliationStore } from "./memory-store.js";

const fundParams = z.object({ fundId: z.string().uuid() });
const reviewItem = z.object({
  kind: z.enum(["unapproved", "ambiguous"]),
  bankTransactionId: z.string().uuid(),
  bankReference: z.string(),
  amountPaise: z.number().int().positive(),
  postedAt: z.string().datetime(),
  counterpartyVpa: z.string().optional(),
  counterpartyAccountFingerprint: z.string().optional(),
});
const reviewResponse = z.object({ items: z.array(reviewItem) });
const responseHeaders = {
  "x-request-id": {
    schema: { type: "string", format: "uuid" },
    description: "Request correlation ID",
    required: true,
  },
} as const;

const listDebitReviewRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/debit-review",
  tags: ["reconciliation"],
  summary: "List unapproved and ambiguous bank debits",
  request: { params: fundParams },
  responses: {
    200: {
      content: { "application/json": { schema: reviewResponse } },
      headers: responseHeaders,
      description: "Debit review items",
    },
  },
});

const resolveDebitRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/debit-review/{bankTransactionId}/resolve",
  tags: ["reconciliation"],
  summary: "Resolve an unapproved debit with an audit reason",
  request: {
    params: z.object({ fundId: z.string().uuid(), bankTransactionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ reason: z.string().trim().min(1).max(500) }) },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ resolved: z.literal(true) }) } },
      headers: responseHeaders,
      description: "Resolved",
    },
  },
});

const manualDebitMatchRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/debit-review/{bankTransactionId}/match",
  tags: ["reconciliation"],
  summary: "Manually match a debit to an approved expense",
  request: {
    params: z.object({ fundId: z.string().uuid(), bankTransactionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            expenseId: z.string().uuid(),
            reason: z.string().trim().min(1).max(500),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ matched: z.literal(true) }) } },
      headers: responseHeaders,
      description: "Debit manually matched",
    },
  },
});

const manualDebitUnmatchRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/debit-review/{bankTransactionId}/unmatch",
  tags: ["reconciliation"],
  summary: "Mark an ambiguous debit as unapproved with an audit reason",
  request: {
    params: z.object({ fundId: z.string().uuid(), bankTransactionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ reason: z.string().trim().min(1).max(500) }) },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ unmatched: z.literal(true) }) } },
      headers: responseHeaders,
      description: "Debit moved to unapproved review",
    },
  },
});

export function registerDebitReviewRoutes(
  app: OpenAPIHono<ApiEnv>,
  options: {
    readonly store: ReconciliationStore;
    readonly authorizeFund: (
      context: Context<ApiEnv>,
      fundId: string,
      ownerOnly: boolean,
    ) => { readonly principal: Principal; readonly resource: ExistingFundResource };
    readonly actorForUser: (userId: string, fundId: string) => Promise<string>;
    readonly redact: <T>(principal: Principal, resource: ExistingFundResource, value: T) => T;
    readonly clock: () => number;
  },
) {
  app.openapi(listDebitReviewRoute, async (context) => {
    const params = context.req.valid("param");
    const { principal, resource } = options.authorizeFund(context, params.fundId, false);
    const items = await options.store.listDebitReview(params.fundId);
    return context.json(options.redact(principal, resource, { items }), 200);
  });

  app.openapi(resolveDebitRoute, async (context) => {
    const params = context.req.valid("param");
    const { principal, resource } = options.authorizeFund(context, params.fundId, true);
    const { reason } = context.req.valid("json");
    const resolved = await options.store.resolveUnapprovedDebit({
      fundId: params.fundId,
      bankTransactionId: params.bankTransactionId,
      reason,
      actorPseudonym: await options.actorForUser(principal.id, params.fundId),
      resolvedAt: new Date(options.clock()).toISOString(),
    });
    if (!resolved) throw new ApiError("not_found");
    return context.json(options.redact(principal, resource, { resolved: true as const }), 200);
  });

  app.openapi(manualDebitMatchRoute, async (context) => {
    const params = context.req.valid("param");
    const { principal, resource } = options.authorizeFund(context, params.fundId, true);
    const { reason, expenseId } = context.req.valid("json");
    const result = await options.store.manualMatchDebit({
      fundId: params.fundId,
      bankTransactionId: params.bankTransactionId,
      expenseId,
      reason,
      actorPseudonym: await options.actorForUser(principal.id, params.fundId),
      occurredAt: new Date(options.clock()).toISOString(),
    });
    if (result.kind === "not_found") throw new ApiError("not_found");
    if (result.kind === "conflict") throw new ApiError("conflict");
    if (result.kind === "amount_mismatch") {
      throw new ApiError("validation_failed", [
        { path: ["json", "expenseId"], message: "Debit and approved expense amounts do not match" },
      ]);
    }
    return context.json(options.redact(principal, resource, { matched: true as const }), 200);
  });

  app.openapi(manualDebitUnmatchRoute, async (context) => {
    const params = context.req.valid("param");
    const { principal, resource } = options.authorizeFund(context, params.fundId, true);
    const { reason } = context.req.valid("json");
    const result = await options.store.manualUnmatchDebit({
      fundId: params.fundId,
      bankTransactionId: params.bankTransactionId,
      reason,
      actorPseudonym: await options.actorForUser(principal.id, params.fundId),
      occurredAt: new Date(options.clock()).toISOString(),
    });
    if (result.kind === "not_found") throw new ApiError("not_found");
    if (result.kind === "conflict") throw new ApiError("conflict");
    if (result.kind === "amount_mismatch") throw new ApiError("conflict");
    return context.json(options.redact(principal, resource, { unmatched: true as const }), 200);
  });
}
