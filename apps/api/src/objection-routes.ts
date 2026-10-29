import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ExpenseRequest, FundPolicy } from "@yen/ledger";
import { isValidRole } from "@yen/policy";
import type { Context } from "hono";
import {
  jsonResponse,
  protectedErrors,
  replayHeader,
  responseHeaders,
  retryHeader,
  withReplay,
} from "./contract.js";
import type { ApiEnv, AppDependencies } from "./dependencies.js";
import { ApiError } from "./errors.js";
import type { ExpenseObjection } from "./expense-objections.js";
import {
  ObjectionConflictError,
  ObjectionNotFoundError,
  ObjectionWindowClosedError,
} from "./expense-objections.js";
import type { ExpenseAction } from "./policy.js";

const params = z.object({ fundId: z.string().uuid(), expenseId: z.string().uuid() });
const body = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const raisedResponse = z.object({ id: z.string().uuid(), status: z.literal("raised") });
const resolvedResponse = z.object({
  status: z.enum(["rejected", "submitted", "approved"]),
  expenseId: z.string().uuid(),
});
const listResponse = z.object({
  count: z.number().int(),
  openCount: z.number().int(),
  objections: z
    .array(
      z.object({
        id: z.string().uuid(),
        createdAt: z.string(),
        resolution: z.enum(["upheld", "dismissed"]).nullable(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
});
const retryableConflict = {
  ...withReplay(protectedErrors[409]),
  headers: { ...responseHeaders, ...replayHeader, ...retryHeader },
};
const replayErrors = {
  400: withReplay(protectedErrors[400]),
  401: withReplay(protectedErrors[401]),
  403: withReplay(protectedErrors[403]),
  404: withReplay(protectedErrors[404]),
  409: retryableConflict,
  429: protectedErrors[429],
  500: protectedErrors[500],
  503: protectedErrors[503],
  504: protectedErrors[504],
};

const listRoute = createRoute({
  method: "get",
  path: "/v1/funds/{fundId}/public/expenses/{expenseId}/objections",
  operationId: "listExpenseObjections",
  tags: ["expenses"],
  request: { params },
  responses: {
    200: jsonResponse(listResponse, "Objection counts and tier redacted records"),
    ...protectedErrors,
  },
});
const raiseRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/objections",
  operationId: "raiseExpenseObjection",
  tags: ["expenses"],
  security: [{ bearerAuth: [] }],
  request: { params, body: { required: true, content: { "application/json": { schema: body } } } },
  responses: {
    201: withReplay(jsonResponse(raisedResponse, "Objection recorded")),
    ...replayErrors,
  },
});
const resolveRoute = createRoute({
  method: "post",
  path: "/v1/funds/{fundId}/expenses/{expenseId}/objections/{objectionId}/resolve",
  operationId: "resolveExpenseObjection",
  tags: ["expenses"],
  security: [{ bearerAuth: [] }],
  request: {
    params: params.extend({ objectionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: body.extend({ resolution: z.enum(["upheld", "dismissed"]) }),
        },
      },
    },
  },
  responses: {
    200: withReplay(jsonResponse(resolvedResponse, "Objection resolved")),
    ...replayErrors,
  },
});

export function redactObjectionList(role: string, records: readonly ExpenseObjection[]) {
  const openCount = records.filter((item) => item.resolution === null).length;
  if (role === "public") return { count: records.length, openCount };
  const canReadReasons = ["member", "owner", "treasurer", "approver", "auditor"].includes(role);
  return {
    count: records.length,
    openCount,
    objections: records.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      resolution: item.resolution,
      ...(canReadReasons ? { reason: item.reason } : {}),
    })),
  };
}

type AuthorizeExpense = (
  context: Context<ApiEnv>,
  action: ExpenseAction,
  expense: ExpenseRequest,
) => void;

export function registerObjectionRoutes(
  app: OpenAPIHono<ApiEnv>,
  deps: AppDependencies,
  findExpense: (fundId: string, expenseId: string) => Promise<ExpenseRequest>,
  policy: FundPolicy,
  authorize: AuthorizeExpense,
): void {
  app.openapi(listRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    await findExpense(fundId, expenseId);
    const principal = c.get("principal");
    const records = deps.objectionStore ? await deps.objectionStore.list(expenseId) : [];
    const role = principal?.role ?? principal?.roles?.find(isValidRole) ?? "public";
    return c.json(redactObjectionList(role, records), 200);
  });
  app.openapi(raiseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const expense = await findExpense(fundId, expenseId);
    const rawPrincipal = c.get("principal");
    if (!rawPrincipal) throw new ApiError("unauthenticated");
    authorize(c, "expense:raise_objection", expense);
    const principal = rawPrincipal;
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (!idempotencyKey) throw new ApiError("validation_failed");
    try {
      const result = await deps.objectionStore?.raise({
        expenseId,
        actorUserId: principal.id,
        reason: c.req.valid("json").reason,
        idempotencyKey,
        nowUtc: new Date(deps.clock()).toISOString(),
      });
      if (!result) throw new ApiError("internal");
      return c.json({ id: result.id, status: "raised" as const }, 201);
    } catch (error) {
      if (error instanceof TypeError) throw new ApiError("validation_failed");
      if (error instanceof ObjectionConflictError || error instanceof ObjectionWindowClosedError)
        throw new ApiError("conflict");
      if (error instanceof ObjectionNotFoundError) throw new ApiError("not_found");
      throw error;
    }
  });
  app.openapi(resolveRoute, async (c) => {
    const { fundId, expenseId, objectionId } = c.req.valid("param");
    const expense = await findExpense(fundId, expenseId);
    const rawPrincipal = c.get("principal");
    if (!rawPrincipal) throw new ApiError("unauthenticated");
    authorize(c, "expense:resolve_objection", expense);
    const principal = rawPrincipal;
    const input = c.req.valid("json");
    try {
      const updated = await deps.objectionStore?.resolve({
        expenseId,
        objectionId,
        actorUserId: principal.id,
        ...input,
        policy,
        nowUtc: new Date(deps.clock()).toISOString(),
      });
      if (!updated) throw new ApiError("internal");
      if (
        updated.status !== "rejected" &&
        updated.status !== "submitted" &&
        updated.status !== "approved"
      ) {
        throw new ApiError("conflict");
      }
      return c.json({ status: updated.status, expenseId }, 200);
    } catch (error) {
      if (error instanceof TypeError) throw new ApiError("validation_failed");
      if (error instanceof ObjectionConflictError) throw new ApiError("conflict");
      if (error instanceof ObjectionNotFoundError) throw new ApiError("not_found");
      throw error;
    }
  });
}
