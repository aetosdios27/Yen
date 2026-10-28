import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { normalizeWaitlistContact } from "@yen/db";
import { parseFundId } from "@yen/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import {
  addMemberRoute,
  approveExpenseRoute,
  changePayeeRoute,
  changePinRoute,
  changePolicyRoute,
  confirmPinResetRoute,
  createFundRoute,
  type fundSchema,
  getFundRoute,
  getPinStatusRoute,
  healthRoute,
  meRoute,
  openapiRoute,
  openapiSchema,
  principalSchema,
  readyRoute,
  rejectExpenseRoute,
  removeMemberRoute,
  requestPinResetRoute,
  setupPinRoute,
  unlockPinRoute,
  verifyPinRoute,
  waitlistRoute,
} from "./contract.js";
import { type ApiEnv, type AppDependencies, defaultDependencies } from "./dependencies.js";
import { ApiError, errorBody, errorStatus, ReadinessError, StoreError } from "./errors.js";
import { logMethod } from "./logging.js";
import {
  idempotency,
  isWaitlistRoute,
  rateLimit,
  requestContext,
  requireAuth,
} from "./middleware.js";
import { computeActionHash } from "./pin/index.js";
import type { FundAction, FundResource } from "./policy.js";

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
    if (error && typeof error === "object" && "retryAfterSeconds" in error) {
      c.header("retry-after", String((error as { retryAfterSeconds: number }).retryAfterSeconds));
    }
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
  app.use("/v1/auth/*", requireAuth);

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

  const getFundOrNotFound = (fundIdString: string) => {
    const id = parseFundId(fundIdString);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    return { id: id.value, resource: { kind: "fund", fund: entry } as const };
  };

  app.openapi(setupPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { pin } = c.req.valid("json");
    await deps.pinService.setupPin(principal.id, pin, { userId: principal.id });
    return c.json({ status: "created" as const, isSet: true as const }, 201);
  });

  app.openapi(getPinStatusRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const status = await deps.pinService.getPinStatus(principal.id);
    return c.json(status, 200);
  });

  app.openapi(verifyPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { pin, actionHash } = c.req.valid("json");
    const result = await deps.pinService.verifyPin(principal.id, pin, actionHash);
    return c.json(result, 200);
  });

  app.openapi(changePinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { currentPin, newPin } = c.req.valid("json");
    await deps.pinService.changePin(principal.id, currentPin, newPin, { userId: principal.id });
    return c.json({ status: "updated" as const }, 200);
  });

  app.openapi(requestPinResetRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const result = await deps.pinService.requestReset(principal.id);
    return c.json({ status: "otp_sent" as const, challengeId: result.challengeId }, 200);
  });

  app.openapi(confirmPinResetRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { otp, newPin } = c.req.valid("json");
    const result = await deps.pinService.confirmReset(principal.id, otp, newPin, {
      userId: principal.id,
    });
    return c.json({ status: "cooling_off" as const, coolingOffUntil: result.coolingOffUntil }, 200);
  });

  app.openapi(unlockPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    if (!deps.policy.can(principal, "fund:member:unlock", { kind: "fund" })) {
      throw new ApiError("forbidden");
    }
    const { targetUserId } = c.req.valid("json");
    await deps.pinService.unlockPin(targetUserId);
    return c.json({ status: "unlocked" as const }, 200);
  });

  app.openapi(approveExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:expense:approve", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body?.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body?.pin;

    const actionDetails = { action: "expense:approve", fundId: id, targetId: expenseId };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    await deps.pinNotificationService.notify({
      kind: "approval_executed",
      approverUserId: principal.id,
      actionHash: computeActionHash(actionDetails),
      recipientRoles: ["approver", "owner"],
      actionSummary: actionDetails,
    });

    return c.json(
      {
        status: "approved" as const,
        expenseId,
        approvedAt: new Date(deps.clock()).toISOString(),
      },
      200,
    );
  });

  app.openapi(rejectExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:expense:reject", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body?.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body?.pin;

    const actionDetails = { action: "expense:reject", fundId: id, targetId: expenseId };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    await deps.pinNotificationService.notify({
      kind: "approval_executed",
      approverUserId: principal.id,
      actionHash: computeActionHash(actionDetails),
      recipientRoles: ["approver", "owner"],
      actionSummary: actionDetails,
    });

    return c.json(
      {
        status: "rejected" as const,
        expenseId,
        reason: body?.reason ?? "policy",
        rejectedAt: new Date(deps.clock()).toISOString(),
      },
      200,
    );
  });

  app.openapi(changePayeeRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:payee:change", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = { action: "payee:change", fundId: id, vpa: body.vpa };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json({ status: "updated" as const, vpa: body.vpa }, 200);
  });

  app.openapi(changePolicyRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:policy:change", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = { action: "policy:change", fundId: id, policy: body.policyJson };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json({ status: "updated" as const, policyJson: body.policyJson }, 200);
  });

  app.openapi(addMemberRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:member:add", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = {
      action: "member:add",
      fundId: id,
      targetId: body.userId,
      role: body.role,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json({ status: "added" as const, memberId: body.userId, role: body.role }, 201);
  });

  app.openapi(removeMemberRoute, async (c) => {
    const { fundId, memberId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:member:remove", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body?.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body?.pin;

    const actionDetails = { action: "member:remove", fundId: id, targetId: memberId };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json({ status: "removed" as const, memberId }, 200);
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
