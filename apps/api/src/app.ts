import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { normalizeWaitlistContact } from "@yen/db";
import {
  createDraftRequest,
  DuplicateApprovalError,
  type ExpenseRequest,
  type FundPolicy,
  InvalidPasskeySignatureError,
  InvalidStateTransitionError,
  type PseudonymId,
  payExpense,
  reconcileExpense,
  rejectExpense,
  SeparationOfDutiesError,
  type SignedApproval,
  submitExpense,
} from "@yen/ledger";
import { paise, parseFundId } from "@yen/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import {
  approveExpenseRoute,
  createExpenseRoute,
  createFundRoute,
  type expenseSchema,
  type fundSchema,
  getExpenseRoute,
  getFundRoute,
  healthRoute,
  listExpensesRoute,
  meRoute,
  openapiRoute,
  openapiSchema,
  payExpenseRoute,
  principalSchema,
  readyRoute,
  reconcileExpenseRoute,
  rejectExpenseRoute,
  submitExpenseRoute,
  waitlistRoute,
} from "./contract.js";
import {
  type ApiEnv,
  type AppDependencies,
  defaultDependencies,
  type Principal,
} from "./dependencies.js";
import { ApiError, errorBody, errorStatus, ReadinessError, StoreError } from "./errors.js";
import { logMethod } from "./logging.js";
import {
  idempotency,
  isWaitlistRoute,
  rateLimit,
  requestContext,
  requireAuth,
} from "./middleware.js";
import type {
  ExistingExpenseResource,
  ExpenseAction,
  ExpenseResource,
  ExpenseView,
  FundAction,
  FundResource,
} from "./policy.js";

export { devPolicy } from "./policy.js";

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const deps = { ...defaultDependencies(overrides.clock), ...overrides };
  const app = new OpenAPIHono<ApiEnv>({
    strict: false,
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError(
          "validation_failed",
          result.error.issues.map((issue) => ({
            path: [
              result.target,
              ...issue.path.map((part) => (typeof part === "number" ? part : String(part))),
            ],
            message: issue.message,
          })),
        );
      }
    },
  });
  app.use("*", requestContext(deps));
  if (deps.corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: deps.corsOrigins,
        allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
        exposeHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replayed"],
      }),
    );
  }
  app.onError((error, c) => {
    const errorKind =
      error instanceof ApiError && error.code === "overloaded"
        ? "rate_limit_store_full"
        : error instanceof ReadinessError
          ? "readiness"
          : error instanceof StoreError
            ? "store"
            : error instanceof ApiError && error.code === "validation_failed"
              ? "validation"
              : error instanceof HTTPException
                ? error.status === 400
                  ? "validation"
                  : "unknown"
                : error instanceof Error
                  ? "handler"
                  : "unknown";
    deps.logger.log({
      event: "http_failure",
      requestId: c.get("requestId"),
      route: routePath(c, -1) || "unmatched",
      method: logMethod(c.req.method),
      errorKind,
      errorName: error instanceof Error ? error.constructor.name : "Unknown",
    });
    const failure =
      error instanceof ApiError
        ? error
        : error instanceof HTTPException && error.status === 400
          ? new ApiError("validation_failed")
          : new ApiError("internal");
    return c.json(
      errorBody(failure, c.get("requestId")),
      error instanceof ReadinessError ? 503 : errorStatus[failure.code],
    );
  });
  app.notFound((c) =>
    c.json(errorBody(new ApiError("not_found"), c.get("requestId")), errorStatus.not_found),
  );
  app.use("/v1/*", rateLimit(deps));
  const waitlistBodyLimit = bodyLimit({
    maxSize: deps.waitlistBodyLimit,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  app.use("/v1/*", (c, next) =>
    isWaitlistRoute(c.req.path) ? waitlistBodyLimit(c, next) : next(),
  );
  app.use("/v1/*", idempotency(deps));
  app.use("/v1/me", requireAuth);
  app.use("/v1/funds/*", requireAuth);

  const funds = new Map<string, { owner: string; fund: z.infer<typeof fundSchema> }>();
  const authorizedFund = (c: Context<ApiEnv>, action: FundAction, resource: FundResource) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    if (!deps.policy.can(principal, action, resource)) {
      throw new ApiError(action === "fund:read" ? "not_found" : "forbidden");
    }
    return principal;
  };
  app.openapi(waitlistRoute, async (c) => {
    const input = c.req.valid("json");
    const contact = normalizeWaitlistContact(input.contact);
    if (contact === null) throw new ApiError("validation_failed");
    const isEmail = contact.includes("@");
    await deps.waitlistStore.add({
      name: input.name,
      contactKind: isEmail ? "email" : "phone",
      contact,
      org: input.org,
      locale: input.locale,
      consentText: input.consent.text,
      consentVersion: input.consent.version,
    });
    return c.json({ status: "received" }, 201);
  });
  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
  app.openapi(readyRoute, async (c) => {
    try {
      if (!(await deps.readiness())) throw new ReadinessError();
    } catch {
      throw new ReadinessError();
    }
    return c.json({ status: "ok" as const }, 200);
  });
  app.openapi(meRoute, (c) => c.json(principalSchema.parse(c.get("principal")), 200));
  app.openapi(createFundRoute, (c) => {
    const principal = authorizedFund(c, "fund:create", { kind: "fund" });
    const id = parseFundId(deps.idGenerator());
    if (!id.ok) throw new ApiError("internal");
    const fund = {
      ...c.req.valid("json"),
      id: id.value,
      createdAt: new Date(deps.clock()).toISOString(),
    };
    const resource = { kind: "fund", fund: { owner: principal.id, fund } } as const;
    funds.set(id.value, resource.fund);
    return c.json(deps.policy.redact(principal, resource), 201);
  });
  app.openapi(getFundRoute, (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    const resource = { kind: "fund", fund: entry } as const;
    const principal = authorizedFund(c, "fund:read", resource);
    return c.json(deps.policy.redact(principal, resource), 200);
  });

  const defaultFundPolicy: FundPolicy = {
    approvalQuorum: 2,
    objectionWindowHours: 0,
    autoExpireHours: 72,
  };

  const toExpenseView = (exp: ExpenseRequest): z.infer<typeof expenseSchema> => ({
    id: exp.id,
    fundId: exp.fundId,
    requesterId: exp.requesterId,
    amountPaise: String(exp.amountPaise),
    description: exp.description,
    recipientRef: exp.recipientRef,
    status: exp.status,
    holdId: exp.holdId,
    approvalsCount: exp.approvals.length,
    supersedesId: exp.supersedesId,
    submittedAt: exp.submittedAt,
    approvedAt: exp.approvedAt,
    rejectedAt: exp.rejectedAt,
    rejectionReason: exp.rejectionReason,
    expiredAt: exp.expiredAt,
    paidAt: exp.paidAt,
    reconciledAt: exp.reconciledAt,
    bankTransactionId: exp.bankTransactionId,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  });

  const authorizedExpense = (
    c: Context<ApiEnv>,
    action: ExpenseAction,
    resource: ExpenseResource,
  ) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    if (!deps.policy.can(principal, action, resource)) {
      throw new ApiError(action === "expense:read" ? "not_found" : "forbidden");
    }
    return principal;
  };

  const redactExpense = (principal: Principal, resource: ExistingExpenseResource): ExpenseView => {
    return deps.policy.redactExpense
      ? deps.policy.redactExpense(principal, resource)
      : resource.expense.expense;
  };

  app.openapi(createExpenseRoute, async (c) => {
    const principal = authorizedExpense(c, "expense:create", { kind: "expense" });
    const fundIdResult = parseFundId(c.req.valid("param").fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const input = c.req.valid("json");
    const amount = paise(Number(input.amountPaise));
    const now = new Date(deps.clock()).toISOString();
    const draft = createDraftRequest({
      id: deps.idGenerator(),
      fundId: fundIdResult.value,
      requesterId: principal.id as PseudonymId,
      amountPaise: amount,
      description: input.description,
      recipientRef: input.recipientRef,
      evidence: input.evidence,
      supersedesId: input.supersedesId,
      createdAt: now,
    });
    await deps.expenseStore.save(draft);
    const view = toExpenseView(draft);
    const resource = { kind: "expense", expense: { owner: principal.id, expense: view } } as const;
    return c.json(redactExpense(principal, resource), 201);
  });

  app.openapi(getExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:read", resource);
    return c.json(redactExpense(principal, resource), 200);
  });

  app.openapi(listExpensesRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const principal = authorizedExpense(c, "expense:read", { kind: "expense" });
    const expenses = await deps.expenseStore.list(fundIdResult.value);
    const redacted = expenses.map((exp) => {
      const view = toExpenseView(exp);
      const resource = {
        kind: "expense",
        expense: { owner: exp.requesterId, expense: view },
      } as const;
      return redactExpense(principal, resource);
    });
    return c.json(redacted, 200);
  });

  app.openapi(submitExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:submit", resource);
    if (expense.status !== "draft") {
      throw new ApiError("conflict");
    }
    const now = new Date(deps.clock()).toISOString();
    const holdId = deps.idGenerator();
    const updated = submitExpense(expense, {
      holdId,
      policy: defaultFundPolicy,
      nowUtc: now,
    });
    await deps.expenseStore.save(updated);
    const updatedView = toExpenseView(updated);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: updated.requesterId, expense: updatedView },
      }),
      200,
    );
  });

  app.openapi(approveExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:approve", resource);
    if (expense.requesterId === principal.id) {
      throw new ApiError("forbidden");
    }
    if (expense.status !== "submitted") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const approval: SignedApproval = {
      approverId: principal.id as PseudonymId,
      passkeySignature: input,
      approvedAt: now,
    };
    try {
      const res = await deps.expenseStore.atomicApprove(
        expenseId,
        approval,
        defaultFundPolicy,
        deps.approvalProofVerifier,
        now,
      );
      const updatedView = toExpenseView(res.expense);
      return c.json(
        redactExpense(principal, {
          kind: "expense",
          expense: { owner: res.expense.requesterId, expense: updatedView },
        }),
        200,
      );
    } catch (err) {
      if (err instanceof SeparationOfDutiesError) throw new ApiError("forbidden");
      if (err instanceof DuplicateApprovalError || err instanceof InvalidStateTransitionError) {
        throw new ApiError("conflict");
      }
      if (err instanceof InvalidPasskeySignatureError) throw new ApiError("validation_failed");
      throw new ApiError("internal");
    }
  });

  app.openapi(rejectExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:reject", resource);
    if (expense.status !== "submitted") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const updated = rejectExpense(expense, input.reason, now);
    await deps.expenseStore.save(updated);
    const updatedView = toExpenseView(updated);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: updated.requesterId, expense: updatedView },
      }),
      200,
    );
  });

  app.openapi(payExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:pay", resource);
    if (expense.status !== "approved") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const updated = payExpense(expense, input.bankTransactionId, now);
    await deps.expenseStore.save(updated);
    const updatedView = toExpenseView(updated);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: updated.requesterId, expense: updatedView },
      }),
      200,
    );
  });

  app.openapi(reconcileExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:reconcile", resource);
    if (expense.status !== "paid") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const updated = reconcileExpense(expense, input.bankTransactionId, now);
    await deps.expenseStore.save(updated);
    const updatedView = toExpenseView(updated);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: updated.requesterId, expense: updatedView },
      }),
      200,
    );
  });
  app.openapi(openapiRoute, (c) => c.json(openapiSchema.parse(openApiDocument(app)), 200));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Reserved for YEN-22. Only injected principals authenticate today.",
  });
  return app;
}

export function openApiDocument(
  app = createApp(),
): ReturnType<OpenAPIHono<ApiEnv>["getOpenAPI31Document"]> {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Yen API",
      version: "1.0.0",
      description:
        "YEN-15 foundation contract. Funds are explicit in-memory stubs. Paise uses decimal strings.",
    },
  });
}
